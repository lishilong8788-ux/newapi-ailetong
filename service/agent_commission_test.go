package service

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCalculateCommission(t *testing.T) {
	cases := []struct {
		name     string
		base     float64
		rate     float64
		expected float64
	}{
		{name: "zero base", base: 0, rate: 0.05, expected: 0},
		{name: "zero rate", base: 100, rate: 0, expected: 0},
		{name: "whole result", base: 100, rate: 0.05, expected: 5},
		{name: "full rate returns base", base: 12.34, rate: 1, expected: 12.34},

		// float64 cannot hold these products exactly; a naive
		// math.Floor(base*rate*100)/100 yields one cent less than the true value.
		{name: "float error would lose a cent at 1.40 x 0.05", base: 1.40, rate: 0.05, expected: 0.07},
		{name: "float error would lose a cent at 0.35 x 0.20", base: 0.35, rate: 0.20, expected: 0.07},
		{name: "float error would lose a cent at 1.50 x 0.30", base: 1.50, rate: 0.30, expected: 0.45},
		{name: "float error would lose a cent at 1.16 x 0.25", base: 1.16, rate: 0.25, expected: 0.29},
		{name: "float error would lose a cent at 3 x 0.07", base: 3, rate: 0.07, expected: 0.21},

		// Rounding is down, not nearest: fractions of a cent are withheld.
		{name: "truncates at half a cent", base: 29.97, rate: 0.05, expected: 1.49},
		{name: "truncates just below the next cent", base: 9.99, rate: 0.10, expected: 0.99},
		{name: "sub-cent result truncates to zero", base: 0.19, rate: 0.05, expected: 0},
		{name: "smallest payable result", base: 0.20, rate: 0.05, expected: 0.01},
		{name: "one cent base yields nothing", base: 0.01, rate: 0.05, expected: 0},
		{name: "one cent base at full rate stays one cent", base: 0.01, rate: 1, expected: 0.01},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			amount, err := CalculateCommission(tc.base, tc.rate)
			require.NoError(t, err)
			assert.Equal(t, tc.expected, amount)
		})
	}
}

func TestCalculateCommissionRejectsInvalidInput(t *testing.T) {
	cases := []struct {
		name     string
		base     float64
		rate     float64
		expected error
	}{
		{name: "negative base", base: -1, rate: 0.05, expected: ErrCommissionBaseInvalid},
		{name: "NaN base", base: math.NaN(), rate: 0.05, expected: ErrCommissionBaseInvalid},
		{name: "positive Inf base", base: math.Inf(1), rate: 0.05, expected: ErrCommissionBaseInvalid},
		{name: "negative Inf base", base: math.Inf(-1), rate: 0.05, expected: ErrCommissionBaseInvalid},
		{name: "negative rate", base: 100, rate: -0.01, expected: ErrCommissionRateInvalid},
		{name: "rate above one", base: 100, rate: 1.01, expected: ErrCommissionRateInvalid},
		{name: "NaN rate", base: 100, rate: math.NaN(), expected: ErrCommissionRateInvalid},
		{name: "Inf rate", base: 100, rate: math.Inf(1), expected: ErrCommissionRateInvalid},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			amount, err := CalculateCommission(tc.base, tc.rate)
			require.ErrorIs(t, err, tc.expected)
			assert.Zero(t, amount)
		})
	}
}
