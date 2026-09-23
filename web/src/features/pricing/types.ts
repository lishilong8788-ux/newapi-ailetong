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
// ----------------------------------------------------------------------------
// Pricing Types
// ----------------------------------------------------------------------------

export type PricingVendor = {
  id: number
  name: string
  icon?: string
  description?: string
}

export type PricingModel = {
  id: number
  model_name: string
  description?: string
  icon?: string
  vendor_id?: number
  vendor_name?: string
  vendor_icon?: string
  vendor_description?: string
  quota_type: number
  /**
   * No price or ratio was ever configured for this model, so `model_ratio` is a
   * fallback constant (37.5) rather than a real rate — read it and you display
   * "$75 / M tokens" for a model the relay refuses outright. Absent on priced
   * models.
   */
  price_unset?: boolean
  model_ratio: number
  completion_ratio: number
  model_price?: number
  cache_ratio?: number | null
  create_cache_ratio?: number | null
  image_ratio?: number | null
  audio_ratio?: number | null
  audio_completion_ratio?: number | null
  /**
   * Vendor list prices, in the same unit as `model_ratio` above (ratio 1 ==
   * $0.002 / 1K tokens), synced from public pricing sources by the backend's
   * official-price sync.
   *
   * Display-only: they drive the struck-through "official price" column and the
   * discount badge, and no billing ever reads them. Absent when the sync has
   * never seen this model — show `-` rather than deriving a comparison from the
   * group ratio, which measures something else entirely (see
   * `lib/price-comparison.ts`).
   */
  official_model_ratio?: number
  official_completion_ratio?: number
  official_cache_ratio?: number | null
  enable_groups: string[]
  tags?: string
  supported_endpoint_types?: string[]
  key?: string
  group_ratio?: Record<string, number>
  /** Billing mode (e.g. "tiered_expr") used to flag dynamic pricing */
  billing_mode?: string
  /** Raw expression describing dynamic / tiered billing */
  billing_expr?: string
  /** Pricing version returned by backend, useful for cache busting */
  pricing_version?: string
  /**
   * Optional model metadata fields reserved for backend-provided catalog data.
   * Keep them data-driven; do not synthesize display values on the client.
   */
  context_length?: number
  max_output_tokens?: number
  knowledge_cutoff?: string
  release_date?: string
  parameter_count?: string
  input_modalities?: Modality[]
  output_modalities?: Modality[]
  capabilities?: ModelCapability[]
}

/** Input/output modalities supported by a model. */
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file'

/** Functional capabilities a model exposes. */
export type ModelCapability =
  | 'function_calling'
  | 'streaming'
  | 'vision'
  | 'json_mode'
  | 'structured_output'
  | 'reasoning'
  | 'tools'
  | 'system_prompt'
  | 'web_search'
  | 'code_interpreter'
  | 'caching'
  | 'embeddings'

export type PricingData = {
  success: boolean
  message?: string
  data: PricingModel[]
  vendors: PricingVendor[]
  group_ratio: Record<string, number>
  /**
   * Group key -> group description, as returned by `service.GetUserUsableGroups`
   * (a Go `map[string]string`). The value IS the description string; it is not
   * an object. The `{ desc, ratio }` shape belongs to `/api/user/self/groups`,
   * which is a different endpoint. Read ratios from `group_ratio` instead.
   */
  usable_group: Record<string, string>
  supported_endpoint: Record<string, string>
  auto_groups: string[]
}

/**
 * Coarse supplier category for a channel, as classified by the backend. The raw
 * channel type stays server-side: a category is as much as a catalog reader
 * needs, and the adaptor name would identify the upstream provider.
 */
export type ChannelCategory =
  | 'vendor'
  | 'public_cloud'
  | 'aggregator'
  | 'self_hosted'
  | 'other'

/** Which rung of the discount chain produced a channel's price. */
export type ChannelPriceSource = 'exact' | 'channel' | 'fallback'

/**
 * What one channel charges for one model. `quota_type` picks the unit: a
 * per-token row carries ratios in exactly the same unit as
 * `PricingModel.model_ratio`, a per-request row carries `model_price` in USD.
 *
 * Ratios rather than formatted prices so the per-channel card reuses the
 * catalog's existing price pipeline (token unit, currency, recharge rate)
 * instead of growing a second formatter that drifts from it.
 */
export type ChannelPrice = {
  /** The model name this channel sends upstream, after `model_mapping`. */
  upstream_model?: string
  /**
   * Configured fraction of the vendor list price. Absent means nobody
   * configured one — which is not the same as 1.0, where an operator
   * deliberately declared "sell at list price".
   */
  discount?: number
  price_source: ChannelPriceSource
  model_ratio: number
  completion_ratio?: number
  cache_ratio?: number
  /**
   * Neither a discount nor a platform ratio exists, so `model_ratio` is a
   * fallback constant and must render as `-` rather than as a price.
   */
  price_unset?: boolean
  /**
   * 0 per-token, 1 per-request — the same vocabulary as
   * `PricingModel.quota_type`. A per-request row prices from `model_price` and
   * leaves `model_ratio` at 0, so a reader that only consults the ratio shows
   * nothing for a model that is in fact priced.
   */
  quota_type?: number
  /**
   * USD per call, when `quota_type` says per-request. Sent even at 0: a free
   * call is a price rather than a missing one, which is why the server omits
   * `omitempty` on this field alone.
   */
  model_price?: number
}

/** One upstream line that can serve a model. */
export type ChannelRoute = {
  channel_id: number
  /**
   * Admin-only. Operators name channels after suppliers, so the public endpoint
   * omits it and the card falls back to `code` / `#id`.
   */
  name?: string
  /**
   * The channel's own line code (`channel.line_code`), e.g. `hs10`. Public: it is
   * how a customer names this line, as `<model>/<code>` in the request's `model`
   * field. Absent when the operator configured none, and such a channel is
   * reachable through automatic routing only.
   */
  code?: string
  category: ChannelCategory
  /** Last channel-test round trip in ms; absent when never tested. */
  latency_ms?: number
  /**
   * Share of real requests this channel served successfully over the last 7
   * days. Absent means no traffic was measured, which is a different statement
   * from 0 ("everything failed") and must not render as the same thing.
   *
   * Only real relay traffic feeds this — a manual channel test does not — so a
   * newly configured line reports nothing until it has served a request.
   */
  availability_pct?: number
  /**
   * Mean time to first token over the same window. Absent when no streaming
   * request has been measured: a non-streaming request has no observable first
   * token, so a channel serving only those reports none.
   */
  ttft_ms?: number
  /**
   * Which measurement `availability_pct` came from. `channel` is this channel's
   * own traffic; `group` means it had none and the figure is the model+group
   * aggregate every channel in that group shares, which the UI marks rather than
   * presenting as a per-channel fact.
   */
  availability_source?: 'channel' | 'group'
  /**
   * Same distinction for `ttft_ms`, tracked separately: a channel serving only
   * non-streaming traffic has a measured availability and a borrowed first-token
   * time, so the two are not always from the same source.
   */
  ttft_source?: 'channel' | 'group'
  /** Viewer-reachable groups this channel serves the model in. */
  groups?: string[]
  price: ChannelPrice
}

/**
 * Routing policy for one model.
 *
 * `enabled && !ranked` is a real and common state: the switch is on but no
 * channel has a discount configured, so there is no price spread to order on and
 * the operator's manual priority still decides. The UI must not promise
 * price-first routing there.
 */
export type AutoRouteInfo = {
  enabled: boolean
  mode: 'lowest_price' | 'manual'
  ranked: boolean
}

export type ChannelPricingData = {
  success: boolean
  message?: string
  data: ChannelRoute[]
  auto_route: AutoRouteInfo
}

export type TokenUnit = 'M' | 'K'
export type PriceType =
  | 'input'
  | 'output'
  | 'cache'
  | 'create_cache'
  | 'image'
  | 'audio_input'
  | 'audio_output'
export type QuotaType = 0 | 1 // 0: token-based, 1: per-request
