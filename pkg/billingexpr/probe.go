package billingexpr

import (
	"fmt"
	"math"

	"github.com/expr-lang/expr"
)

// probeTokens is the token count fed to one dimension at a time, matching the
// v1 quota conversion's own divisor (see quotaConversion): with 1M tokens on a
// single variable, dividing the expression output by probeTokens leaves exactly
// that dimension's coefficient, which v1 defines as its $/1M price.
const probeTokens = 1_000_000

// ListPrices holds the per-1M-token prices an expression charges for each token
// dimension, in USD.
//
// CacheRead carries a presence flag because zero and absent mean different
// things. An expression that never mentions `cr` is not pricing cache reads at
// $0 — it is not pricing them separately at all, and those tokens fall back to
// the input price. Probing such an expression with cache tokens returns 0, so
// without the flag a model with no published cache price would advertise free
// cache reads.
//
// Cache *creation* is not probed: nothing consumes an official create-cache price
// today, and probing costs an extra evaluation per model across a few thousand
// models per sync. Add it here alongside a consumer, not ahead of one.
type ListPrices struct {
	Input        float64
	Output       float64
	CacheRead    float64
	HasCacheRead bool
}

// ProbeListPrices recovers the published per-1M-token prices from a billing
// expression by evaluating it once per token dimension.
//
// This works because of the v1 contract in expr.md: "Prices are real prices —
// expression coefficients are actual $/1M tokens prices as published by
// providers." So an expression is not just a billing rule, it is a machine-
// readable copy of the vendor's price list, and running it with 1M tokens on one
// variable and zero on the rest reads that price back out. Evaluating beats
// pattern-matching the string: it handles `p * 3`, `3 * p`, parenthesized sums,
// multi-tier ternaries and time-of-day branches without a parser of its own.
//
// Len is pinned to 1 so a tiered expression settles on its entry tier — the
// headline price a buyer is quoted. Time-dependent expressions resolve against
// the clock at call time, so a happy-hour price is captured as of the probe.
//
// Programs are compiled and thrown away rather than going through
// CompileFromCache: a catalog sync probes hundreds of expressions at once and
// the shared cache holds 256 entries before it drops everything, so caching
// probes would evict the programs live billing traffic is using.
//
// Returns an error if the expression does not compile, if any dimension fails to
// evaluate, or if the input price is not a usable positive number — the other
// dimensions are expressed relative to input, so without it there is nothing to
// anchor them to.
func ProbeListPrices(exprStr string) (ListPrices, error) {
	version, body := ParseExprVersion(exprStr)
	patcher := &requestRulePatcher{}
	prog, err := expr.Compile(body, expr.Env(getCompileEnv(version)), expr.Patch(patcher), expr.AsFloat64())
	if patcher.restrictedIdentifier != "" {
		return ListPrices{}, fmt.Errorf("expr compile error: identifier %q is reserved for internal use", patcher.restrictedIdentifier)
	}
	if err != nil {
		return ListPrices{}, fmt.Errorf("expr compile error: %w", err)
	}

	probe := func(params TokenParams) (float64, error) {
		params.Len = 1
		cost, _, err := runProgram(prog, patcher.requestRules, params, RequestInput{})
		if err != nil {
			return 0, err
		}
		if math.IsNaN(cost) || math.IsInf(cost, 0) || cost < 0 {
			return 0, fmt.Errorf("expr produced unusable price %v", cost)
		}
		return cost / probeTokens, nil
	}

	input, err := probe(TokenParams{P: probeTokens})
	if err != nil {
		return ListPrices{}, err
	}
	if input <= 0 {
		return ListPrices{}, fmt.Errorf("expr has no positive input price")
	}
	output, err := probe(TokenParams{C: probeTokens})
	if err != nil {
		return ListPrices{}, err
	}

	prices := ListPrices{Input: input, Output: output}
	usedVars := extractUsedVars(prog)
	if usedVars["cr"] {
		prices.CacheRead, err = probe(TokenParams{CR: probeTokens})
		if err != nil {
			return ListPrices{}, err
		}
		prices.HasCacheRead = true
	}
	return prices, nil
}
