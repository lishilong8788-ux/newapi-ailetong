package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// applyMarginColumns denormalizes the billing snapshot onto sortable columns.
// These tests pin the invariants a margin report depends on; each failure mode
// here is a wrong number on an admin's screen, not a style issue.

// TestApplyMarginColumnsDerivesMarginFromRowQuota pins margin to the row's own
// revenue rather than the snapshot's margin_quota. SUM(margin) must equal
// SUM(quota) - SUM(cost) for every filter, which only holds if margin is derived
// from the same quota the revenue total sums.
func TestApplyMarginColumnsDerivesMarginFromRowQuota(t *testing.T) {
	log := &Log{Quota: 1000}
	applyMarginColumns(log, map[string]interface{}{
		"admin_info": map[string]interface{}{
			"cost": map[string]interface{}{
				"cost_source": "exact",
				"cost_quota":  400,
				// Snapshot margin disagrees with this row (it was computed against a
				// different revenue). The column must follow the row, not the snapshot.
				"margin_quota": 999,
			},
		},
	})

	assert.Equal(t, 400, log.CostQuota)
	assert.Equal(t, "exact", log.CostSource)
	assert.Equal(t, 600, log.MarginQuota, "margin must be quota - cost, not the snapshot's figure")
}

// TestApplyMarginColumnsSkipsNonRowScopedSnapshot is the double-count guard.
// Task differential settlement writes a snapshot describing the task TOTAL while
// the row's quota is only the delta, and the submission row already carried the
// full cost. Copying both would count one task's upstream cost twice and report
// a negative margin on a profitable task.
func TestApplyMarginColumnsSkipsNonRowScopedSnapshot(t *testing.T) {
	log := &Log{Quota: 200}
	applyMarginColumns(log, map[string]interface{}{
		"admin_info": map[string]interface{}{
			"cost": map[string]interface{}{
				"cost_source":  "exact",
				"cost_quota":   5000,
				"margin_quota": 3000,
				"row_scoped":   false,
			},
			"price": map[string]interface{}{"line_code": "gpt-fast"},
		},
	})

	assert.Zero(t, log.CostQuota)
	assert.Zero(t, log.MarginQuota)
	assert.Empty(t, log.CostSource, "a task-total snapshot must leave the row unpriced")
	// The route still identifies the row; only the cost is out of scope.
	assert.Equal(t, "gpt-fast", log.LineCode)
}

// TestApplyMarginColumnsUnknownCostStaysZero guards the most dangerous silent
// error in this accounting: the backend writes cost_quota 0 alongside
// cost_source 'unknown', and storing that 0 as a cost reports 100% margin on a
// request nobody priced.
func TestApplyMarginColumnsUnknownCostStaysZero(t *testing.T) {
	for _, source := range []string{"unknown", ""} {
		log := &Log{Quota: 700}
		applyMarginColumns(log, map[string]interface{}{
			"admin_info": map[string]interface{}{
				"cost": map[string]interface{}{
					"cost_source":  source,
					"cost_quota":   0,
					"margin_quota": 700,
				},
			},
		})

		assert.Zero(t, log.CostQuota, "source %q must not yield a cost", source)
		assert.Zero(t, log.MarginQuota, "source %q must not yield a margin", source)
	}
}

// TestApplyMarginColumnsPricedSourceWithoutNumber covers a malformed snapshot:
// a priced grade with no cost number. The row must read as unpriced rather than
// as a zero-cost sale, so the grade is dropped along with the value.
func TestApplyMarginColumnsPricedSourceWithoutNumber(t *testing.T) {
	log := &Log{Quota: 500}
	applyMarginColumns(log, map[string]interface{}{
		"admin_info": map[string]interface{}{
			"cost": map[string]interface{}{"cost_source": "exact"},
		},
	})

	assert.Empty(t, log.CostSource)
	assert.Zero(t, log.CostQuota)
	assert.Zero(t, log.MarginQuota)
}

// TestApplyMarginColumnsReadsFloatCostQuota covers the backfill path, where the
// snapshot has been through JSON and every number arrives as float64. A type
// switch handling only int would silently zero the cost on every historical row.
func TestApplyMarginColumnsReadsFloatCostQuota(t *testing.T) {
	log := &Log{Quota: 1200}
	applyMarginColumns(log, map[string]interface{}{
		"admin_info": map[string]interface{}{
			"cost": map[string]interface{}{
				"cost_source": "reported",
				"cost_quota":  float64(350),
			},
		},
	})

	assert.Equal(t, 350, log.CostQuota)
	assert.Equal(t, 850, log.MarginQuota)
}

// TestApplyMarginColumnsRecordsTrafficSource pins the ops-traffic tag, which the
// ledger filters on. A channel test costs real upstream money and earns nothing,
// so counting it as customer traffic reports a loss that never happened.
func TestApplyMarginColumnsRecordsTrafficSource(t *testing.T) {
	log := &Log{Quota: 100}
	applyMarginColumns(log, map[string]interface{}{
		"traffic_source": "channel_test",
		"admin_info": map[string]interface{}{
			"cost": map[string]interface{}{"cost_source": "exact", "cost_quota": 40},
		},
	})

	assert.Equal(t, "channel_test", log.TrafficSource)
	// Still priced: the exclusion is the report's job, not the column's.
	assert.Equal(t, 40, log.CostQuota)
}

// TestApplyMarginColumnsNegativeMargin pins that a genuine loss survives. Cost
// above revenue is the case the whole ledger exists to surface, so it must not
// be clamped to zero anywhere on the write path.
func TestApplyMarginColumnsNegativeMargin(t *testing.T) {
	log := &Log{Quota: 300}
	applyMarginColumns(log, map[string]interface{}{
		"admin_info": map[string]interface{}{
			"cost": map[string]interface{}{"cost_source": "exact", "cost_quota": 500},
		},
	})

	assert.Equal(t, -200, log.MarginQuota)
}

// TestApplyMarginColumnsNoSnapshot covers logs written before cost accounting
// existed: no admin_info at all. They must stay unpriced, not become free sales.
func TestApplyMarginColumnsNoSnapshot(t *testing.T) {
	log := &Log{Quota: 900}
	applyMarginColumns(log, map[string]interface{}{"model_ratio": 2.5})

	require.Empty(t, log.CostSource)
	assert.Zero(t, log.CostQuota)
	assert.Zero(t, log.MarginQuota)
}
