package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The amount printed in an invoice email is the figure the customer reconciles
// against their payment, so the minor-unit split must be exact: a missing zero
// turns ¥0.50 into ¥0.5 and a dropped pad turns ¥0.05 into ¥0.5.
func TestFormatInvoiceAmount(t *testing.T) {
	cases := []struct {
		name     string
		amount   int64
		currency string
		want     string
	}{
		{"cny whole yuan", 80000, "CNY", "¥800.00"},
		{"usd with cents", 1234, "USD", "$12.34"},
		{"cny single cent pads", 5, "CNY", "¥0.05"},
		{"cny ten cents pads", 50, "CNY", "¥0.50"},
		{"cny one yuan", 100, "CNY", "¥1.00"},
		{"zero", 0, "CNY", "¥0.00"},
		{"large total", 999999999, "CNY", "¥9999999.99"},
		{"unknown currency falls back to code", 1234, "EUR", "EUR 12.34"},
		{"empty currency treated as cny", 1234, "", "¥12.34"},
		{"negative keeps sign before symbol", -1234, "CNY", "-¥12.34"},
		{"negative sub-unit", -5, "USD", "-$0.05"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, formatInvoiceAmount(c.amount, c.currency))
		})
	}
}
