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

import type { Channel } from '../../types'
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  transformChannelToFormDefaults,
  transformFormDataToUpdatePayload,
  type ChannelFormValues,
} from '../channel-form'

function channelWithSettings(settings: Record<string, unknown>): Channel {
  return {
    id: 7,
    type: 1,
    name: 'upstream',
    models: 'gpt-5',
    group: 'default',
    settings: JSON.stringify(settings),
    channel_info: {},
  } as unknown as Channel
}

function savedSettings(formValues: Partial<ChannelFormValues>) {
  const payload = transformFormDataToUpdatePayload(
    {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      name: 'upstream',
      type: 1,
      key: 'sk-test',
      models: 'gpt-5',
      group: ['default'],
      ...formValues,
    },
    7
  )
  return JSON.parse(payload.settings as string) as Record<string, unknown>
}

describe('channel cost settings form boundary', () => {
  test('stores markup as a fraction and per-model buy prices verbatim', () => {
    expect(
      savedSettings({
        cost_markup_percent: 30,
        cost_models: [
          { model: 'deepseek-v4.1', input: 0.49, output: 1.96 },
          { model: 'gpt-5', input: 1, output: 2, markup_percent: 50 },
        ],
      }).cost
    ).toEqual({
      default_markup: 0.3,
      models: {
        'deepseek-v4.1': { input: 0.49, output: 1.96 },
        'gpt-5': { input: 1, output: 2, markup: 0.5 },
      },
    })
  })

  test('a 0 per-model markup is stored, not dropped as falsy', () => {
    expect(
      savedSettings({
        cost_markup_percent: 30,
        cost_models: [{ model: 'free-model', input: 2, markup_percent: 0 }],
      }).cost
    ).toEqual({
      default_markup: 0.3,
      models: { 'free-model': { input: 2, markup: 0 } },
    })
  })

  test('nothing configured drops the cost key entirely', () => {
    expect(
      savedSettings({ cost_markup_percent: 0, cost_models: [] })
    ).not.toHaveProperty('cost')
  })

  test('a 0 channel markup is stored once a model is priced', () => {
    // Selling at cost. Without `default_markup` the backend finds no markup,
    // ResolveSellPrice reports not-configured, and the channel silently falls
    // back to legacy modelRatio × group_ratio billing — so the operator asks to
    // break even and gets the old price instead.
    expect(
      savedSettings({
        cost_markup_percent: 0,
        cost_models: [{ model: 'gpt-5', input: 1, output: 2 }],
      }).cost
    ).toEqual({
      default_markup: 0,
      models: { 'gpt-5': { input: 1, output: 2 } },
    })
  })

  test('a 0 channel markup round-trips back into the form', () => {
    const defaults = transformChannelToFormDefaults(
      channelWithSettings({
        cost: { default_markup: 0, models: { 'gpt-5': { input: 1 } } },
      })
    )

    expect(defaults.cost_markup_percent).toBe(0)
    expect(defaults.cost_json).toBe('')
  })

  test('raw JSON is submitted verbatim in place of the table', () => {
    expect(
      savedSettings({
        cost_markup_percent: 30,
        cost_models: [{ model: 'gpt-5', input: 1 }],
        cost_json: '{"models":{"gpt-5":{"cache_read":0.1}}}',
      }).cost
    ).toEqual({ models: { 'gpt-5': { cache_read: 0.1 } } })
  })

  test('markup and per-model markup round-trip through the form', () => {
    const defaults = transformChannelToFormDefaults(
      channelWithSettings({
        cost: {
          default_markup: 0.3,
          models: {
            'gpt-5': { input: 1, output: 2, markup: 0.5 },
            'claude-5': { input: 3 },
          },
        },
      })
    )

    expect(defaults.cost_markup_percent).toBe(30)
    expect(defaults.cost_json).toBe('')
    expect(defaults.cost_models).toEqual([
      { model: 'gpt-5', input: 1, output: 2, markup_percent: 50 },
      {
        model: 'claude-5',
        input: 3,
        output: undefined,
        markup_percent: undefined,
      },
    ])
  })

  test('legacy mode/discount/expr keys still open in the table, not the JSON box', () => {
    // Settings written by the previous form always carried `mode`. Treating it
    // as unknown would strand every already-configured channel in the raw JSON
    // box with an empty table, which reads as data loss.
    const defaults = transformChannelToFormDefaults(
      channelWithSettings({
        cost: {
          mode: 'ratio',
          discount: 0.85,
          default_markup: 0.3,
          models: { 'gpt-5': { input: 1, output: 2 } },
        },
      })
    )

    expect(defaults.cost_json).toBe('')
    expect(defaults.cost_markup_percent).toBe(30)
    expect(defaults.cost_models).toHaveLength(1)
  })

  test('a cached-read buy price round-trips through the table', () => {
    const defaults = transformChannelToFormDefaults(
      channelWithSettings({
        cost: { models: { 'gpt-5': { input: 1, cache_read: 0.1 } } },
      })
    )

    expect(defaults.cost_json).toBe('')
    expect(defaults.cost_models).toEqual([
      {
        model: 'gpt-5',
        input: 1,
        output: undefined,
        cache_read: 0.1,
        markup_percent: undefined,
      },
    ])
    expect(
      savedSettings({
        cost_markup_percent: 20,
        cost_models: defaults.cost_models,
      }).cost
    ).toEqual({
      default_markup: 0.2,
      models: { 'gpt-5': { input: 1, cache_read: 0.1 } },
    })
  })

  test('every kind ModelCostPrice defines round-trips through the table', () => {
    // Was the opposite assertion: cache write used to stay in the JSON box
    // because SellPriceToRatios emitted model/completion/cache only, so a price
    // typed here would never be charged. It emits all nine ratios now, so the
    // table owns the kind and the JSON box must stay empty — a model landing in
    // the JSON box reads to the operator as "not editable here".
    const defaults = transformChannelToFormDefaults(
      channelWithSettings({
        cost: {
          models: {
            'gpt-5': {
              input: 1,
              cache_write_5m: 0.5,
              cache_write_1h: 0.8,
              audio_in: 40,
              audio_out: 80,
              image_in: 2.5,
              image_out: 10,
              reasoning: 12,
              per_call: 0.04,
            },
          },
        },
      })
    )

    expect(defaults.cost_json).toBe('')
    const row = defaults.cost_models?.[0]
    expect(row).toMatchObject({
      model: 'gpt-5',
      input: 1,
      cache_write_5m: 0.5,
      cache_write_1h: 0.8,
      audio_in: 40,
      audio_out: 80,
      image_in: 2.5,
      image_out: 10,
      reasoning: 12,
      per_call: 0.04,
    })
  })

  test('a key this build does not know keeps the raw JSON box', () => {
    // The escape hatch still has a job: a cost object written by a newer build
    // (per_second is on the pricing side but not yet on the cost side) must not
    // be flattened into fields that would drop it on the next save.
    const defaults = transformChannelToFormDefaults(
      channelWithSettings({
        cost: { models: { 'gpt-5': { input: 1, per_second: 0.02 } } },
      })
    )

    expect(defaults.cost_json).not.toBe('')
    expect(JSON.parse(defaults.cost_json as string)).toEqual({
      models: { 'gpt-5': { input: 1, per_second: 0.02 } },
    })
  })
})

describe('sell discount is no longer editable here', () => {
  test('a stored price survives a save from this form untouched', () => {
    // The drawer no longer edits `price`. Dropping the key would put every
    // channel back on legacy modelRatio × group_ratio billing the first time
    // anyone opened the drawer and hit save.
    const stored = {
      price: { discount: 0.44, models: { 'gpt-5': 0.6 }, updated_at: 1 },
    }
    const defaults = transformChannelToFormDefaults(channelWithSettings(stored))

    expect(savedSettings({ settings: defaults.settings }).price).toEqual(
      stored.price
    )
  })
})
