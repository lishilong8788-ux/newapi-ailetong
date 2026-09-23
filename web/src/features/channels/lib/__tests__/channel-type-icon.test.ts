import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, test } from 'vitest'

import { CHANNEL_TYPES } from '../../constants'
import {
  getChannelTypeIcon,
  MONOGRAM_ONLY_CHANNEL_TYPES,
} from '../channel-utils'

// A name that is not a real @lobehub/icons export does not throw: getLobeIcon
// silently falls back to a first-letter circle, so a typo ships as a missing
// brand icon and nobody notices. Read the package's own export list and check
// every mapped name against it.
//
// The package itself cannot be imported here — @lobehub/icons pulls in
// @lobehub/fluent-emoji, whose directory imports break under vitest's ESM
// resolver — so parse the export names out of its compiled entry instead.
const require = createRequire(import.meta.url)
const iconsEntry = require.resolve('@lobehub/icons/es/icons.js')
const source = readFileSync(iconsEntry, 'utf8')

const exported = new Set(
  [...source.matchAll(/\bas\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1])
)

// Names this app supplies itself, registered in CUSTOM_ICONS.
const CUSTOM = new Set(['Sub2API', 'GenericEndpoint', 'UnknownChannel'])

describe('channel type icon mapping', () => {
  test('the icons package exposes a plausible number of exports', () => {
    // Guards the regex above: if the package's build output changes shape and
    // nothing parses, every assertion below would pass vacuously.
    expect(exported.size).toBeGreaterThan(200)
  })

  const liveTypes = Object.keys(CHANNEL_TYPES)
    .map(Number)
    .filter((t) => t !== 0)

  test.each(liveTypes)('type %i maps to a resolvable icon', (type) => {
    const name = getChannelTypeIcon(type)
    const baseKey = name.split('.')[0]

    // Types listed as monogram-only intentionally resolve to a name no icon
    // pack provides; asserting they resolve would defeat the point.
    if (MONOGRAM_ONLY_CHANNEL_TYPES[type]) {
      expect(baseKey).toBe(MONOGRAM_ONLY_CHANNEL_TYPES[type])
      expect(
        exported.has(baseKey),
        `type ${type} is marked monogram-only, but @lobehub/icons now ships "${baseKey}" — drop it from MONOGRAM_ONLY_CHANNEL_TYPES and map it instead`
      ).toBe(false)
      return
    }

    expect(
      exported.has(baseKey) || CUSTOM.has(baseKey),
      `type ${type} (${CHANNEL_TYPES[type as keyof typeof CHANNEL_TYPES]}) maps to "${name}", which is neither a @lobehub/icons export nor a CUSTOM_ICONS entry`
    ).toBe(true)
  })

  test('unmapped types do not borrow a vendor identity', () => {
    // 61 is ChannelTypeMiniMaxH3 in the backend but absent from CHANNEL_TYPES.
    expect(getChannelTypeIcon(61)).toBe('UnknownChannel')
    expect(getChannelTypeIcon(9999)).toBe('UnknownChannel')
  })
})
