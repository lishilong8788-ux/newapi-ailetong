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
import { render } from '@testing-library/react'
import { vi } from 'vitest'

import type { ChannelRoute } from '@/features/pricing/types'

import { ChannelPicker, type ChannelPickerProps } from '../channel-picker'

/** A fallback-priced aggregator line with no measurements, the state of a fresh install. */
export function buildRoute(
  overrides: Partial<ChannelRoute> = {}
): ChannelRoute {
  return {
    channel_id: 7,
    category: 'aggregator',
    price: { price_source: 'fallback', model_ratio: 0.5 },
    ...overrides,
  }
}

/**
 * Renders the picker read-only by default, which is what every viewer without
 * admin sees. Suites that need the controls pass `canPin`.
 */
export function renderPicker(overrides: Partial<ChannelPickerProps> = {}) {
  const onChannelChange = overrides.onChannelChange ?? vi.fn()

  render(
    <ChannelPicker
      modelName='glm-5.2'
      routes={[]}
      isLoading={false}
      canPin={false}
      {...overrides}
      onChannelChange={onChannelChange}
    />
  )

  return onChannelChange
}
