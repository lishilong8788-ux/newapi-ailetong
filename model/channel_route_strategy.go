package model

import (
	"errors"
	"fmt"
	"math/rand"
	"sort"

	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/route_setting"
)

// Route modes. The string values are what the option store and the admin UI
// exchange, so they are part of the wire contract and must not be renamed.
const (
	// RouteModeOff orders candidates by the operator's manual priority. This is
	// the behaviour that shipped before routing became configurable, and it stays
	// the fallback for every unresolved or unknown mode.
	RouteModeOff = "off"
	// RouteModePrice orders by resolved sell price, cheapest first.
	RouteModePrice = "price"
)

// Candidate is where the two selection paths converge: the memory-cache path
// builds these from its in-process maps, the database path from an abilities
// query. Everything a Strategy needs to rank must be present here — a strategy
// that reaches back to a data source would reintroduce the per-path divergence
// this type exists to remove.
type Candidate struct {
	ChannelID int
	// Priority is the operator's manual ordering. Higher wins.
	Priority int64
	// Weight decides the split among candidates that share a tier.
	Weight int
}

// Strategy turns candidates into an ordering. Adding a routing mode means adding
// one implementation and one registry entry; because both selection paths run
// the same Strategy through selectFromCandidates, a new mode cannot land on one
// path and silently miss the other.
type Strategy interface {
	Name() string
	// Tier is the ranking key, higher first. Candidates sharing a tier are a
	// failover group and get weighted-random treatment within it.
	Tier(c Candidate) int64
	// WeightOf is the intra-tier weight, letting a mode redistribute traffic
	// without changing the tiering.
	WeightOf(c Candidate) int
}

// manualPriorityStrategy is the switch-off path: tier by the priority the
// operator typed, split by the weight they typed.
type manualPriorityStrategy struct{}

func (manualPriorityStrategy) Name() string             { return RouteModeOff }
func (manualPriorityStrategy) Tier(c Candidate) int64   { return c.Priority }
func (manualPriorityStrategy) WeightOf(c Candidate) int { return c.Weight }

// priceRankStrategy tiers by the synthetic rank buildChannelPriceRanks derives
// from resolved sell prices. ranks is captured at resolve time so one request
// sees one consistent snapshot even if the table is refreshed mid-flight.
//
// This strategy is only ever constructed for a model that is actually ranked, so
// a channel absent from ranks is one added between refreshes, not an unranked
// model. It sinks to priceRankUnresolved rather than borrowing its manual
// priority: a channel with no known price must not preempt a known-cheap one.
// Same rule channelPriceRankFor applies, kept identical so the refactor does not
// shift the pre-existing cache-path ordering.
type priceRankStrategy struct {
	ranks map[int]int64
}

func (priceRankStrategy) Name() string { return RouteModePrice }

func (s priceRankStrategy) Tier(c Candidate) int64 {
	if rank, ok := s.ranks[c.ChannelID]; ok {
		return rank
	}
	return priceRankUnresolved
}

func (priceRankStrategy) WeightOf(c Candidate) int { return c.Weight }

// resolveStrategy picks the mode for one request and snapshots whatever table it
// needs. Both selection paths call this, which is the point: the mode decision
// happens once, in one place, instead of once per path.
//
// Caller must hold channelSyncLock (read lock) — the price rank table is swapped
// under its write lock.
//
// The mode currently comes from the global auto-route switch. When per-user and
// per-model-group overrides land, they resolve here and nothing downstream of
// this function has to change.
func resolveStrategy(modelName string) Strategy {
	if !route_setting.AutoRouteEnabled() {
		return manualPriorityStrategy{}
	}

	// Only models with a real price spread are ranked (see buildChannelPriceRanks);
	// everything else keeps the manual priority, so an install with no configured
	// discounts behaves identically with the switch on.
	if ranks, ok := model2channelPriceRank[modelName]; ok {
		return priceRankStrategy{ranks: ranks}
	}
	// A client-facing name like "gpt-4-0613" is ranked under its normalized form.
	if normalized := ratio_setting.FormatMatchingModelName(modelName); normalized != modelName {
		if ranks, ok := model2channelPriceRank[normalized]; ok {
			return priceRankStrategy{ranks: ranks}
		}
	}
	return manualPriorityStrategy{}
}

// selectCandidate is the single implementation of "given candidates and a
// strategy, which channel serves this request". Both the memory-cache path and
// the database path route through here, so a routing mode is either available on
// both or on neither — the divergence that let auto-route silently do nothing on
// the database path is structurally impossible once this is the only ranker.
//
// retry walks down the tiers: 0 is the best tier, 1 the next, and anything past
// the last tier stays on the last one rather than failing, matching the failover
// semantics both paths already had.
//
// Requires len(candidates) > 0; callers handle the empty set, because "no
// candidate" means different things to them (nil channel vs. a query miss).
func selectCandidate(candidates []Candidate, strategy Strategy, retry int) (int, error) {
	if len(candidates) == 0 {
		return 0, errors.New("selectCandidate called with no candidates")
	}

	tierSet := make(map[int64]bool, len(candidates))
	for _, c := range candidates {
		tierSet[strategy.Tier(c)] = true
	}
	tiers := make([]int64, 0, len(tierSet))
	for tier := range tierSet {
		tiers = append(tiers, tier)
	}
	sort.Slice(tiers, func(i, j int) bool { return tiers[i] > tiers[j] })

	if retry >= len(tiers) {
		retry = len(tiers) - 1
	}
	if retry < 0 {
		retry = 0
	}
	targetTier := tiers[retry]

	var inTier []Candidate
	sumWeight := 0
	for _, c := range candidates {
		if strategy.Tier(c) == targetTier {
			inTier = append(inTier, c)
			sumWeight += strategy.WeightOf(c)
		}
	}
	if len(inTier) == 0 {
		// Unreachable: targetTier came from these candidates. Explicit anyway,
		// because a strategy whose Tier is not a pure function would land here and
		// silently returning channel 0 would route the request to nothing.
		return 0, fmt.Errorf("no candidate in tier %d", targetTier)
	}

	return pickWeighted(inTier, strategy, sumWeight), nil
}

// pickWeighted is the weighted random draw within one tier, lifted verbatim from
// the memory-cache path so that path's behaviour is unchanged by the extraction.
//
// The smoothing exists because operators leave weights at 0 or set them very
// small: without it, an all-zero tier can never be drawn from, and a tier of
// 1-vs-2 would swing traffic harder than the numbers suggest. The database path
// used to do a different, unsmoothed draw (weight+10), which meant identical
// channel config split traffic differently depending on whether the memory cache
// happened to be on. This is now the only draw.
func pickWeighted(inTier []Candidate, strategy Strategy, sumWeight int) int {
	smoothingFactor := 1
	smoothingAdjustment := 0
	if sumWeight == 0 {
		// Every weight is 0: treat the tier as an even split rather than a dead end.
		sumWeight = len(inTier) * 100
		smoothingAdjustment = 100
	} else if sumWeight/len(inTier) < 10 {
		smoothingFactor = 100
	}

	randomWeight := rand.Intn(sumWeight * smoothingFactor)
	for _, c := range inTier {
		randomWeight -= strategy.WeightOf(c)*smoothingFactor + smoothingAdjustment
		if randomWeight < 0 {
			return c.ChannelID
		}
	}
	// Rounding can leave the draw unsatisfied; the last candidate is the tier's
	// own member, so this is a valid selection rather than a fallback.
	return inTier[len(inTier)-1].ChannelID
}
