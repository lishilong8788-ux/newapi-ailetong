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
import type { CostPricingKind } from '../../../../lib'

/**
 * Per-kind display text. Kept apart from the arithmetic because every string is
 * a translation key and `t()` has to run during render.
 *
 * The hint says what the number covers, not what it does: `reach` on the kind
 * itself carries that, and the sheet only marks the kinds where it is a
 * surprise — a price that moves the margin report but can never move a bill.
 */
export const KIND_TEXT: Record<
  CostPricingKind,
  { label: string; hint: string; placeholder: string }
> = {
  input: { label: 'Input', hint: 'Text prompt tokens.', placeholder: '2.50' },
  output: { label: 'Output', hint: 'Generated tokens.', placeholder: '10.00' },
  cache_read: {
    label: 'Cache read',
    hint: 'Cached prompt reads.',
    placeholder: '0.25',
  },
  cache_write_5m: {
    label: 'Cache write (5m)',
    hint: 'Writing a 5-minute cache entry.',
    placeholder: '3.75',
  },
  cache_write_1h: {
    label: 'Cache write (1h)',
    hint: 'Writing a 1-hour cache entry.',
    placeholder: '6.00',
  },
  image_in: {
    label: 'Image input',
    hint: 'Image tokens in the prompt.',
    placeholder: '2.50',
  },
  image_out: {
    label: 'Image output',
    hint: 'Generated image tokens.',
    placeholder: '10.00',
  },
  audio_in: {
    label: 'Audio input',
    hint: 'Audio tokens in the prompt.',
    placeholder: '40.00',
  },
  audio_out: {
    label: 'Audio output',
    hint: 'Generated audio tokens.',
    placeholder: '80.00',
  },
  reasoning: {
    label: 'Reasoning',
    hint: 'Thinking tokens, where the vendor prices them apart.',
    placeholder: '10.00',
  },
  per_call: {
    label: 'Per request',
    hint: 'A flat price per request, in USD.',
    placeholder: '0.04',
  },
}
