package controller

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The PDF link is mailed to a customer and used as a redirect target, so it has
// to be a public hostname. The plain `http(s)://` prefix check this replaced let
// `https://11111` through: browsers read a bare number as an integer-form IPv4
// address (11111 -> 0.0.43.103) and security interstitials block it, which is
// exactly what a customer reported seeing instead of their invoice.
func TestValidateInvoicePdfUrl(t *testing.T) {
	cases := []struct {
		name     string
		rawUrl   string
		accepted bool
	}{
		{name: "https host", rawUrl: "https://invoice.example.com/a.pdf", accepted: true},
		{name: "http host", rawUrl: "http://invoice.example.com/a.pdf", accepted: true},
		{name: "punycode tld", rawUrl: "https://发票.xn--fiqs8s/a.pdf", accepted: true},
		{name: "host with port", rawUrl: "https://invoice.example.com:8443/a.pdf", accepted: true},

		{name: "integer form address", rawUrl: "https://11111", accepted: false},
		{name: "dotted ipv4", rawUrl: "https://203.0.113.10/a.pdf", accepted: false},
		{name: "ipv6 literal", rawUrl: "https://[2001:db8::1]/a.pdf", accepted: false},
		{name: "localhost", rawUrl: "http://localhost:3000/a.pdf", accepted: false},
		{name: "numeric tld", rawUrl: "https://example.123/a.pdf", accepted: false},
		{name: "single label host", rawUrl: "https://intranet/a.pdf", accepted: false},
		{name: "one character tld", rawUrl: "https://example.c/a.pdf", accepted: false},
		{name: "non web scheme", rawUrl: "ftp://invoice.example.com/a.pdf", accepted: false},
		{name: "scheme relative", rawUrl: "//invoice.example.com/a.pdf", accepted: false},
		{name: "javascript scheme", rawUrl: "javascript:alert(1)", accepted: false},
		{name: "missing host", rawUrl: "https:///a.pdf", accepted: false},
		{name: "over length", rawUrl: "https://invoice.example.com/" + strings.Repeat("a", 1024), accepted: false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateInvoicePdfUrl(testCase.rawUrl)
			if testCase.accepted {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.NotEmpty(t, err.Error())
		})
	}
}
