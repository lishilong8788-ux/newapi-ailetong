/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, test } from 'vitest'

import { getModelGuide, refineGuide, type ModelGuide } from '../model-guide'
import { CAPABILITY_REGISTRY } from '../registry'
import type { PlaygroundModality } from '../types'

const MODALITIES = Object.keys(
  CAPABILITY_REGISTRY
) as unknown as PlaygroundModality[]

describe('getModelGuide', () => {
  test('resolves a guide for every registered modality', () => {
    for (const modality of MODALITIES) {
      const guide = getModelGuide(modality)

      expect(guide, modality).toBeDefined()
      expect(guide?.tagline, modality).not.toBe('')
      expect(guide?.strengths.length, modality).toBeGreaterThan(0)
      expect(guide?.examples.length, modality).toBeGreaterThan(0)
    }
  })

  test('returns undefined when the modality could not be derived', () => {
    // Models with no catalog entry reach the panel without a modality, and the
    // caller falls back to its generic empty state rather than rendering blank.
    expect(getModelGuide(undefined)).toBeUndefined()
    expect(getModelGuide(undefined, 'some-unknown-model')).toBeUndefined()
  })

  test('falls back to the modality guide for a model with no override', () => {
    expect(getModelGuide('chat', 'a-model-nobody-overrode')).toEqual(
      getModelGuide('chat')
    )
  })
})

describe('refineGuide', () => {
  const base = getModelGuide('chat') as ModelGuide

  test('returns the base guide untouched when there is no override', () => {
    expect(refineGuide(base, undefined)).toBe(base)
  })

  test('replaces only the overridden fields', () => {
    const refined = refineGuide(base, { tagline: 'Reasoning-first model.' })

    expect(refined.tagline).toBe('Reasoning-first model.')
    expect(refined.strengths).toEqual(base.strengths)
    expect(refined.examples).toEqual(base.examples)
  })

  test('replaces caveats wholesale instead of appending to them', () => {
    // Merging arrays would carry a modality-wide warning onto a model that does
    // not have that problem, which is worse than showing nothing.
    const refined = refineGuide(base, { caveats: ['Only this one applies.'] })

    expect(refined.caveats).toEqual(['Only this one applies.'])
  })

  test('every example carries an icon, a label and a prompt', () => {
    // The panel renders these as buttons that fill the composer; a blank prompt
    // would produce a button that silently does nothing.
    for (const modality of MODALITIES) {
      for (const example of getModelGuide(modality)?.examples ?? []) {
        expect(example.icon, modality).not.toBe('')
        expect(example.label, modality).not.toBe('')
        expect(example.prompt, modality).not.toBe('')
      }
    }
  })
})
