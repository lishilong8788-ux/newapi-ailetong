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
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { STATUS_QUERY_KEY, type StatusRecord } from '@/lib/status-query'

import type { PricingModel } from '../types'

// Decorative here, and `@lobehub/icons` transitively loads a JSON module the
// test loader cannot resolve.
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
import { extractAllTags } from '../lib/filters'

function buildModel(id: number, tags?: string): PricingModel {
  return {
    id,
    model_name: `model-${id}`,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    tags,
  }
}

/**
 * Seeds `/api/status` rather than mocking `useTagRegistry`, so the real
 * status -> registry -> `resolveTag` path runs. A fresh cache entry keeps the
 * query function off the network.
 */
function renderRail(
  models: PricingModel[],
  overrides: Partial<PricingSidebarProps> = {},
  status?: StatusRecord
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (status) queryClient.setQueryData(STATUS_QUERY_KEY, status)

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
    vendors: [],
    groups: ['default'],
    // The rail is fed exactly what the pricing page feeds it, so a chip that
    // reports a value the filter cannot match would fail here.
    tags: extractAllTags(models),
    models,
    hasActiveFilters: false,
    onClearFilters: vi.fn(),
    ...overrides,
  }

  return render(<PricingSidebar {...props} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

/** Scopes to the tag facet: "All Tags" also names the section trigger. */
function tagChips() {
  return within(screen.getByRole('group', { name: 'Model Tags' })).getAllByRole(
    'button'
  )
}

function tagChip(name: RegExp) {
  return within(screen.getByRole('group', { name: 'Model Tags' })).getByRole(
    'button',
    { name }
  )
}

describe('pricing rail tag chips', () => {
  test('offers one chip for a tag spelled several ways across the catalog', () => {
    renderRail([
      buildModel(1, 'Hot'),
      buildModel(2, 'hot'),
      buildModel(3, '热门'),
    ])

    // "All Tags" plus exactly one tag chip.
    expect(tagChips()).toHaveLength(2)
    expect(tagChip(/^Hot/)).toBeInTheDocument()
  })

  test('counts every spelling of a tag towards its single chip', () => {
    renderRail([
      buildModel(1, 'Hot'),
      buildModel(2, 'hot'),
      buildModel(3, 'vision'),
    ])

    expect(tagChip(/^Hot/)).toHaveAccessibleName('Hot2')
    expect(tagChip(/^Vision/)).toHaveAccessibleName('Vision1')
  })

  test('offers a tag containing a space as one chip, not two fragments', () => {
    renderRail([buildModel(1, 'long context')])

    expect(tagChips()).toHaveLength(2)
    expect(tagChip(/^Long context/)).toHaveAccessibleName('Long context1')
  })

  test('reports the canonical slug when a tag chip is clicked', async () => {
    const onTagChange = vi.fn()
    renderRail([buildModel(1, 'long context')], { onTagChange })

    await userEvent.click(tagChip(/^Long context/))

    expect(onTagChange).toHaveBeenCalledWith('long-context')
  })

  test('marks the chip pressed when the filter holds its slug', () => {
    renderRail([buildModel(1, 'Hot'), buildModel(2, 'vision')], {
      tagFilter: 'hot',
    })

    expect(tagChip(/^Hot/)).toHaveAttribute('aria-pressed', 'true')
    expect(tagChip(/^Vision/)).toHaveAttribute('aria-pressed', 'false')
  })

  test('labels a chip from the operator registry rather than the stored text', () => {
    renderRail([buildModel(1, '旗舰')], undefined, {
      model_tag_registry: [
        {
          slug: 'flagship',
          color: 'purple',
          kind: 'promo',
          labels: { en: 'Flagship' },
          aliases: ['旗舰'],
        },
      ],
    })

    expect(tagChip(/^Flagship/)).toHaveAccessibleName('Flagship1')
  })

  test('shows no tag chips beyond the all-tags entry for an untagged catalog', () => {
    renderRail([buildModel(1), buildModel(2)])

    expect(tagChips()).toHaveLength(1)
    expect(tagChip(/^All Tags/)).toBeInTheDocument()
  })
})
