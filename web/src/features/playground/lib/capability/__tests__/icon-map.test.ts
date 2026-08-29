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

import { getCapabilityIcon } from '../icon-map'
import { getModelGuide } from '../model-guide'
import { CAPABILITY_REGISTRY } from '../registry'
import type { PlaygroundModality } from '../types'

const MODALITIES = Object.keys(
  CAPABILITY_REGISTRY
) as unknown as PlaygroundModality[]

/**
 * The registry and the guides reference icons by string, so a typo cannot be
 * caught by the compiler — it silently renders nothing. These tests are the
 * only thing standing between a renamed icon and a blank chip in production.
 */
describe('capability icon registration', () => {
  test('every chip and submode icon in the registry resolves', () => {
    for (const modality of MODALITIES) {
      const capability = CAPABILITY_REGISTRY[modality]

      for (const chip of capability.params) {
        expect(
          getCapabilityIcon(chip.icon),
          `${modality}/${chip.id}`
        ).toBeDefined()
      }

      for (const submode of capability.submodes ?? []) {
        expect(
          getCapabilityIcon(submode.icon),
          `${modality}/${submode.id}`
        ).toBeDefined()
      }
    }
  })

  test('every guide example icon resolves', () => {
    for (const modality of MODALITIES) {
      for (const example of getModelGuide(modality)?.examples ?? []) {
        expect(
          getCapabilityIcon(example.icon),
          `${modality}/${example.label}`
        ).toBeDefined()
      }
    }
  })

  test('an unregistered name resolves to undefined rather than throwing', () => {
    expect(getCapabilityIcon('NoSuchIcon')).toBeUndefined()
  })
})
