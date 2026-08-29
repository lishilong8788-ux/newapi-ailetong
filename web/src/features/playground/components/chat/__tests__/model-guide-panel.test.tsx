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

// The vendor mark is decorative here, and `@lobehub/icons` transitively loads
// `@lobehub/fluent-emoji`, whose directory-style ES import the test loader
// cannot resolve. Stubbed at the same boundary the pricing suite uses.
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

import type { ModelOption } from '../../../types'
import { PlaygroundEmptyState } from '../playground-empty-state'

const CHAT_MODEL: ModelOption = {
  label: 'claude-opus-5',
  value: 'claude-opus-5',
  modality: 'chat',
  vendorName: 'Anthropic',
  description: 'Anthropic’s most capable model.',
}

/**
 * `video` is `available: false` in the registry, which is what gates the notice.
 * Image was this fixture until its relay flow was verified end to end; the panel
 * only reads `available`, so any unopened modality serves.
 */
const UNOPENED_MODEL: ModelOption = {
  label: 'sora-2',
  value: 'sora-2',
  modality: 'video',
  vendorName: 'OpenAI',
}

describe('PlaygroundEmptyState', () => {
  test('renders the guide for the selected model', () => {
    render(<PlaygroundEmptyState model={CHAT_MODEL} onSelectPrompt={vi.fn()} />)

    expect(screen.getByText('claude-opus-5')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('Billed per token')).toBeInTheDocument()
  })

  test('keeps the modality badge out of the name row', () => {
    // Sharing a centred row with the badge pushed the name off the mark's axis
    // by half the badge's width, which read as crooked without being obviously
    // so. The name has to be the only thing in its own element.
    render(<PlaygroundEmptyState model={CHAT_MODEL} onSelectPrompt={vi.fn()} />)

    const name = screen.getByRole('heading', { level: 2 })

    expect(name).toHaveTextContent('claude-opus-5')
    expect(name).not.toHaveTextContent('Chat')
  })

  test('shows the description an operator wrote on the model', () => {
    render(<PlaygroundEmptyState model={CHAT_MODEL} onSelectPrompt={vi.fn()} />)

    expect(
      screen.getByText('Anthropic’s most capable model.')
    ).toBeInTheDocument()
  })

  test('says so when no description has been written', () => {
    // The modality tagline used to fill this gap, which meant every chat model
    // claimed to be good at "reasoning, writing and code" — including ones it
    // misdescribes. Saying nothing was written is the honest answer.
    render(
      <PlaygroundEmptyState
        model={{ ...CHAT_MODEL, description: undefined }}
        onSelectPrompt={vi.fn()}
      />
    )

    expect(
      screen.getByText(/No description has been added/)
    ).toBeInTheDocument()
  })

  test('treats a description that only repeats the model name as blank', () => {
    render(
      <PlaygroundEmptyState
        model={{ ...CHAT_MODEL, description: CHAT_MODEL.label }}
        onSelectPrompt={vi.fn()}
      />
    )

    expect(
      screen.getByText(/No description has been added/)
    ).toBeInTheDocument()
  })

  test('offers no starter prompts once a model is selected', () => {
    // The prompts on offer were per-modality, so every chat model got the same
    // four — "review code" in front of a maths-tuned checkpoint. A suggestion
    // that does not know which model it belongs to is worse than none.
    render(<PlaygroundEmptyState model={CHAT_MODEL} onSelectPrompt={vi.fn()} />)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  test('a modality whose relay is not open shows a notice', () => {
    render(
      <PlaygroundEmptyState model={UNOPENED_MODEL} onSelectPrompt={vi.fn()} />
    )

    const notice = screen.getByRole('status')

    expect(notice).toHaveTextContent('Not open yet')
    // The body used to open by restating the heading — "Not open yet · This
    // capability is not open yet. You can browse…" — which is what padded the
    // line out to fill a box wider than it needed.
    // No space around the middot: it is spaced with `mx-1.5`, so `textContent`
    // runs the three spans together.
    expect(notice).toHaveTextContent(
      'Not open yet·You can browse the model, but requests cannot be sent.'
    )
  })

  test('keeps the vendor with the name rather than in the attribute chips', () => {
    // The vendor was a third chip beside the modality and the billing unit. Those
    // two describe what the model does and what it costs; the vendor is part of
    // who it is, so presenting all three as peers compared three unrelated axes.
    render(<PlaygroundEmptyState model={CHAT_MODEL} onSelectPrompt={vi.fn()} />)

    const vendor = screen.getByText('Anthropic')
    const chipRow = screen.getByText('Billed per token').parentElement

    expect(chipRow).not.toBeNull()
    expect(chipRow).not.toContainElement(vendor)
  })

  test('an open modality shows no notice', () => {
    render(<PlaygroundEmptyState model={CHAT_MODEL} onSelectPrompt={vi.fn()} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('falls back to the generic prompts when no model is selected', () => {
    // The window between mount and the model list arriving must not be blank.
    render(<PlaygroundEmptyState onSelectPrompt={vi.fn()} />)

    expect(screen.getByText('Start a playground chat')).toBeInTheDocument()
  })

  test('the generic prompts still fill the composer', async () => {
    // This branch is model-agnostic by definition, so a generic suggestion is
    // appropriate here in a way it is not once a model is known.
    const onSelectPrompt = vi.fn()
    render(<PlaygroundEmptyState onSelectPrompt={onSelectPrompt} />)

    await userEvent.click(screen.getByRole('button', { name: /Analyze data/ }))

    expect(onSelectPrompt).toHaveBeenCalledWith('Analyze data')
  })
})
