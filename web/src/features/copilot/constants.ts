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
export const COPILOT_ENDPOINTS = {
  STATUS: '/api/copilot/status',
  SESSIONS: '/api/copilot/sessions',
  MODELS: '/api/copilot/models',
  CONFIG: '/api/copilot/config',
  IMAGES: '/api/copilot/images',
} as const

export const QUERY_KEY_COPILOT_STATUS = 'copilot-status'
export const QUERY_KEY_COPILOT_SESSIONS = 'copilot-sessions'
export const QUERY_KEY_COPILOT_SESSION = 'copilot-session'
export const QUERY_KEY_COPILOT_MODELS = 'copilot-models'

/**
 * The copilot's own section of the settings page, not the page's first tab.
 *
 * Linking to `/system-settings/models` landed on Global Model Configuration — two
 * JSON editors that have nothing to do with the copilot — which is a worse outcome
 * than no link at all: the reader concludes the notice pointed them at the wrong
 * place, or that this is what configuring the copilot looks like.
 */
export const COPILOT_SETTINGS_URL = '/system-settings/models/$section'

/** Section id of the copilot block in the models settings page. */
export const COPILOT_SETTINGS_SECTION = 'copilot'

/** Pin cleared: the copilot routes normally. Spelled as 0 on the wire. */
export const COPILOT_AUTO_CHANNEL_ID = 0

/**
 * The two modes, spelled exactly as the backend's `ModeAsk` / `ModeAct`.
 *
 * The server treats any unrecognised value — including the empty string an older
 * client sends — as read-only, so a typo here fails closed. That is the safe
 * direction, but it fails *silently*: the tab would read "Smart actions" while
 * the model never receives a write tool. Hence the shared constants rather than
 * inline strings at the two call sites.
 */
export const COPILOT_MODE_ASK = 'ask'
export const COPILOT_MODE_ACT = 'act'

export const SESSION_PAGE_SIZE = 50

/**
 * Seed prompts for the rail and the empty state.
 *
 * Values are the i18n keys (English source strings), rendered with `t()` — the
 * convention `AGENTS.md` sets for copy that lives in constants. Deliberately the
 * four questions the tool layer can actually answer end to end, so a first click
 * demonstrates a real query rather than an apology.
 */
export const COPILOT_EXAMPLE_PROMPTS = [
  'What was our gross margin last month?',
  'Which channel is losing money?',
  'How far below list price are we selling gpt-5.5?',
  'Which channels serve deepseek, and what does each one cost?',
] as const

export const ERROR_MESSAGES = {
  STREAM_START: 'Failed to start the copilot stream.',
  STREAM_CLOSED: 'The copilot connection closed unexpectedly.',
  SESSION_LOAD_FAILED: 'Failed to load this conversation.',
  SESSION_CREATE_FAILED: 'Failed to start a new conversation.',
  SESSION_DELETE_FAILED: 'Failed to delete this conversation.',
  CONFIG_SAVE_FAILED: 'Failed to save the copilot configuration.',
} as const

export const SUCCESS_MESSAGES = {
  SESSION_DELETED: 'Conversation deleted',
  CONFIG_SAVED: 'Copilot configuration updated',
} as const

/**
 * Human-readable names for the tools the copilot may call, keyed by the
 * `tool_name` the backend sends.
 *
 * Values are i18n keys. An unmapped name falls back to the raw identifier
 * (`lib/tool-label.ts`) rather than to a generic "tool" label: an admin reading
 * these rows to verify the copilot queried the system is better served by the
 * real function name than by a placeholder that hides it.
 */
export const TOOL_LABEL_KEYS: Record<string, string> = {
  query_margin: 'Read margin',
  query_cost_overview: 'Read cost overview',
  search_models: 'Search models',
  get_model_pricing: 'Read model pricing',
  list_channels: 'Read channel list',
  get_channel_cost: 'Read channel cost and margin',
  get_official_price: 'Read list price',
  simulate_sell_price: 'Simulate a sell price',
  simulate_margin_impact: 'Simulate the margin impact',
  set_channel_markup: 'Set the channel default markup',
}
