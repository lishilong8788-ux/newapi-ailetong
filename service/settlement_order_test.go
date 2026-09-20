package service

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

// The claim that a configured discount cannot yet move money rests entirely on
// call order: attachSellPrice runs after SettleBilling, so the figure it records
// is an observation of a bill already paid. Reading the files is how that was
// established; this asserts it, so a future refactor that hoists the snapshot
// above settlement cannot quietly turn a reporting field into a price.
//
// If the repricing work lands, this test SHOULD fail — and the failure is the
// prompt to re-verify every path deliberately rather than discover it from a
// customer's invoice.
func TestSettlementOrder_SnapshotRunsAfterSettleBilling(t *testing.T) {
	files := []string{"quota.go", "text_quota.go"}

	type site struct {
		fn       string
		settle   token.Pos
		snapshot token.Pos
	}
	found := 0

	for _, name := range files {
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}

		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			s := site{fn: fn.Name.Name}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				switch callee := call.Fun.(type) {
				case *ast.Ident:
					switch callee.Name {
					case "SettleBilling":
						if !s.settle.IsValid() {
							s.settle = call.Pos()
						}
					case "attachSellPrice":
						if !s.snapshot.IsValid() {
							s.snapshot = call.Pos()
						}
					}
				}
				return true
			})

			if !s.settle.IsValid() || !s.snapshot.IsValid() {
				continue
			}
			found++
			if s.settle > s.snapshot {
				t.Errorf("%s: %s calls attachSellPrice (line %d) BEFORE SettleBilling (line %d) — "+
					"the snapshot would be shaping the charge instead of recording it",
					name, s.fn,
					fset.Position(s.snapshot).Line, fset.Position(s.settle).Line)
			}
		}
	}

	// Guards against the assertion silently covering nothing: a rename that
	// breaks the match would otherwise leave this test passing over zero sites.
	if found < 3 {
		t.Fatalf("matched %d settlement sites, want at least 3 (wss, audio, text) — "+
			"a rename likely made this test vacuous", found)
	}
}

// Containment: the discount resolvers must stay reachable only from the snapshot
// file. Order alone is not enough — a call from anywhere that computes a charge
// would put the discount into a bill no matter where SettleBilling sits. This
// fails the moment someone wires a resolver into a pricing path, which is the
// exact change that needs a deliberate review rather than a silent merge.
func TestSettlementOrder_DiscountResolversAreNotReachableFromBillingPaths(t *testing.T) {
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(fi os.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go") && fi.Name() != "price_resolution.go"
	}, 0)
	if err != nil {
		t.Fatalf("parse service package: %v", err)
	}

	guarded := map[string]bool{"ResolveSellDiscount": true, "ComputeListPriceQuota": true}
	scanned := 0

	for _, pkg := range pkgs {
		for name, file := range pkg.Files {
			scanned++
			ast.Inspect(file, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				id, ok := call.Fun.(*ast.Ident)
				if !ok || !guarded[id.Name] {
					return true
				}
				t.Errorf("%s:%d calls %s outside price_resolution.go — a discount reached a billing path",
					name, fset.Position(call.Pos()).Line, id.Name)
				return true
			})
		}
	}

	if scanned < 10 {
		t.Fatalf("scanned only %d files; the filter is likely excluding the package", scanned)
	}
}

// The task paths settle outside the function that records the snapshot, so the
// AST check above cannot see them. Pin their shape instead: neither task site may
// call SettleBilling at all, which is what makes them pure recorders.
func TestSettlementOrder_TaskSitesDoNotSettle(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "task_billing.go", nil, 0)
	if err != nil {
		t.Fatalf("parse task_billing.go: %v", err)
	}

	snapshotFns := map[string]bool{}
	for _, decl := range f.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		var hasSnapshot, hasSettle bool
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			if id, ok := call.Fun.(*ast.Ident); ok {
				switch id.Name {
				case "attachSellPrice", "attachSellPriceForChannel":
					hasSnapshot = true
				case "SettleBilling":
					hasSettle = true
				}
			}
			return true
		})
		if hasSnapshot {
			snapshotFns[fn.Name.Name] = true
			if hasSettle {
				t.Errorf("%s settles and snapshots in one function; order must be asserted explicitly", fn.Name.Name)
			}
		}
	}

	if len(snapshotFns) < 2 {
		t.Fatalf("found %d task snapshot sites, want 2 (submit, differential settlement)", len(snapshotFns))
	}
}
