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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { GroupOption } from '../../../types'
import { GroupRow } from '../group-row'

const GROUPS: GroupOption[] = [
  { label: 'default', value: 'default', ratio: 1, desc: 'Standard channels' },
  { label: 'vip', value: 'vip', ratio: 0.85, desc: 'Direct channels' },
]

describe('GroupRow', () => {
  test('renders nothing when the user has a single usable group', () => {
    const { container } = render(
      <GroupRow groups={[GROUPS[0]]} value='default' onChange={vi.fn()} />
    )

    // A select with one option is furniture, not a choice.
    expect(container).toBeEmptyDOMElement()
  })

  test('renders nothing when no group is usable', () => {
    const { container } = render(
      <GroupRow groups={[]} value='' onChange={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  test('shows the multiplier on the closed face', () => {
    render(<GroupRow groups={GROUPS} value='vip' onChange={vi.fn()} />)

    // The ratio is the whole substance of a group, so it has to be readable
    // without opening the popover.
    expect(screen.getByText('×0.85')).toBeInTheDocument()
    expect(screen.getByText('vip')).toBeInTheDocument()
  })

  test('pads a whole-number ratio to one decimal', () => {
    render(<GroupRow groups={GROUPS} value='default' onChange={vi.fn()} />)

    expect(screen.getByText('×1.0')).toBeInTheDocument()
  })

  test('omits the suffix for the non-numeric ratio the backend sends for auto', () => {
    const groups: GroupOption[] = [
      ...GROUPS,
      // `controller/group.go` sets auto's ratio to the string "自动", since it
      // resolves per request.
      { label: 'auto', value: 'auto', ratio: '自动' as unknown as number },
    ]

    render(<GroupRow groups={groups} value='auto' onChange={vi.fn()} />)

    expect(screen.getByText('auto')).toBeInTheDocument()
    // `×自动` would read as arithmetic on a word.
    expect(screen.queryByText(/×/)).not.toBeInTheDocument()
  })

  test('reports the picked group and closes the popover', async () => {
    const onChange = vi.fn()
    render(<GroupRow groups={GROUPS} value='default' onChange={onChange} />)

    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByText('Direct channels'))

    expect(onChange).toHaveBeenCalledWith('vip')
  })
})
