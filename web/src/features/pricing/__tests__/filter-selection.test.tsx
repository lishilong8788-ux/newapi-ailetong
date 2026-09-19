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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

import type { PricingModel, PricingVendor } from '../types'

// The vendor mark is decorative here and `@lobehub/icons` transitively loads
// `@lobehub/ui` -> `@emoji-mart/data`, a JSON module the test loader cannot
// resolve. Stubbed at that boundary so the chips still render a mark.
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

// Imported from the module, not the `../components` barrel: the barrel pulls in
// the model details drawer, which transitively loads emoji-mart's JSON data set.
import {
  PricingSidebar,
  type PricingSidebarProps,
} from '../components/pricing-sidebar'
import { ENDPOINT_TYPES, FILTER_ALL, QUOTA_TYPES } from '../constants'

const VENDORS: PricingVendor[] = [
  { id: 1, name: 'Anthropic' },
  { id: 2, name: 'DeepSeek' },
]

const MODELS: PricingModel[] = [
  {
    id: 1,
    model_name: 'claude-opus-5',
    vendor_name: 'Anthropic',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
  },
  {
    id: 2,
    model_name: 'deepseek-v4',
    vendor_name: 'DeepSeek',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
  },
]

/** Holds `vendorFilter` in state, the way the pricing page does. */
function ControlledSidebar(props: PricingSidebarProps) {
  const [vendorFilter, setVendorFilter] = useState(props.vendorFilter)

  return (
    <PricingSidebar
      {...props}
      vendorFilter={vendorFilter}
      onVendorChange={(value) => {
        setVendorFilter(value)
        props.onVendorChange(value)
      }}
    />
  )
}

/**
 * The rail resolves tag chips through `useTagRegistry`, which reads the operator
 * registry off the shared `/api/status` query. An empty client is enough — with
 * no cached entry the hook falls through to the built-in tag vocabulary — but
 * the provider itself is mandatory, or `useQuery` throws.
 */
function queryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderSidebar(
  overrides: Partial<PricingSidebarProps> = {},
  options: { controlled?: boolean } = {}
) {
  const props: PricingSidebarProps = {
    quotaTypeFilter: QUOTA_TYPES.ALL,
    endpointTypeFilter: ENDPOINT_TYPES.ALL,
    vendorFilter: FILTER_ALL,
    groupFilter: FILTER_ALL,
    tagFilter: FILTER_ALL,
    onQuotaTypeChange: vi.fn(),
    onEndpointTypeChange: vi.fn(),
    onVendorChange: vi.fn(),
    onGroupChange: vi.fn(),
    onTagChange: vi.fn(),
    vendors: VENDORS,
    groups: ['default', 'vip'],
    groupRatios: { default: 1, vip: 0.8 },
    tags: [],
    models: MODELS,
    hasActiveFilters: false,
    onClearFilters: vi.fn(),
    ...overrides,
  }

  const wrapper = queryWrapper()
  if (options.controlled) {
    return render(<ControlledSidebar {...props} />, { wrapper })
  }
  return render(<PricingSidebar {...props} />, { wrapper })
}

/** Scopes to one facet: "All Vendors" also names the section's own trigger. */
function vendorChip(name: RegExp) {
  const group = screen.getByRole('group', { name: 'All Vendors' })
  return within(group).getByRole('button', { name })
}

describe('pricing filter chip selection', () => {
  test('marks only the selected vendor chip as pressed', () => {
    renderSidebar({ vendorFilter: 'Anthropic' })

    expect(vendorChip(/Anthropic/)).toHaveAttribute('aria-pressed', 'true')
    expect(vendorChip(/DeepSeek/)).toHaveAttribute('aria-pressed', 'false')
  })

  test('moves the pressed state to the vendor the user picks', async () => {
    // Driven through a click on a controlled wrapper rather than a rerender, so
    // it exercises the same state round-trip the page does.
    renderSidebar({ vendorFilter: 'Anthropic' }, { controlled: true })

    expect(vendorChip(/Anthropic/)).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(vendorChip(/DeepSeek/))

    expect(vendorChip(/DeepSeek/)).toHaveAttribute('aria-pressed', 'true')
    expect(vendorChip(/Anthropic/)).toHaveAttribute('aria-pressed', 'false')
  })

  test('reports the chosen vendor when a chip is clicked', async () => {
    const onVendorChange = vi.fn()
    renderSidebar({ onVendorChange })

    await userEvent.click(vendorChip(/DeepSeek/))

    expect(onVendorChange).toHaveBeenCalledWith('DeepSeek')
  })

  test('selects a chip with the keyboard', async () => {
    const onVendorChange = vi.fn()
    renderSidebar({ onVendorChange })

    const chip = vendorChip(/DeepSeek/)
    chip.focus()
    await userEvent.keyboard('{Enter}')

    expect(chip).toHaveFocus()
    expect(onVendorChange).toHaveBeenCalledWith('DeepSeek')
  })

  test('disables Reset until a filter is active', () => {
    renderSidebar({ hasActiveFilters: false })

    expect(screen.getByRole('button', { name: /Reset/ })).toBeDisabled()
  })

  test('enables Reset and reports a clear once a filter is active', async () => {
    const onClearFilters = vi.fn()
    renderSidebar({ hasActiveFilters: true, onClearFilters })

    const reset = screen.getByRole('button', { name: /Reset/ })
    expect(reset).toBeEnabled()

    await userEvent.click(reset)

    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })
})
