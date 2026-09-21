import { describe, expect, it } from 'vitest'

import { isPublicHttpUrl } from '../invoice-forms'

describe('isPublicHttpUrl', () => {
  it('accepts ordinary public addresses', () => {
    expect(isPublicHttpUrl('https://invoice.example.com/a.pdf')).toBe(true)
    expect(isPublicHttpUrl('http://example.co.uk')).toBe(true)
  })

  it('accepts punycode hosts, which Chinese invoicing platforms use', () => {
    expect(isPublicHttpUrl('https://xn--fiqs8s/发票.pdf')).toBe(false)
    expect(isPublicHttpUrl('https://fapiao.xn--fiqs8s/a.pdf')).toBe(true)
  })

  it('rejects the bare-number host that parses but never resolves', () => {
    // `new URL('https://11111')` succeeds and browsers read the host as an
    // integer-form IPv4 address, so the customer gets an interstitial.
    expect(isPublicHttpUrl('https://11111')).toBe(false)
    expect(isPublicHttpUrl('https://1.2.3.4/a.pdf')).toBe(false)
  })

  it('rejects hosts that are not publicly reachable', () => {
    expect(isPublicHttpUrl('https://localhost:3000/a.pdf')).toBe(false)
    expect(isPublicHttpUrl('http://[::1]/a.pdf')).toBe(false)
    expect(isPublicHttpUrl('https://example.123')).toBe(false)
  })

  it('rejects non-web schemes and unparseable input', () => {
    expect(isPublicHttpUrl('file:///C:/invoice.pdf')).toBe(false)
    expect(isPublicHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isPublicHttpUrl('not a url')).toBe(false)
    expect(isPublicHttpUrl('')).toBe(false)
  })
})
