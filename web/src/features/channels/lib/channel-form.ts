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
import { z } from 'zod'

import {
  CLAUDE_FIELD_PASSTHROUGH_TYPES,
  CHANNEL_TYPE_NEW_API,
  CHANNEL_STATUS,
  ERROR_MESSAGES,
  FIELD_PASSTHROUGH_TYPES,
  MODEL_FETCHABLE_TYPES,
  OPENAI_FIELD_PASSTHROUGH_TYPES,
} from '../constants'
import type { Channel, ChannelCostSettings } from '../types'
import {
  CHANNEL_TYPE_ADVANCED_CUSTOM,
  advancedCustomConfigUsesRelativeUpstreamPath,
  hasValidAdvancedCustomModelListRoute,
  parseAdvancedCustomConfig,
  stringifyAdvancedCustomConfig,
  validateAdvancedCustomConfig,
} from './advanced-custom'
import {
  MAX_MARKUP_PERCENT,
  markupFractionToPercent,
  markupPercentToFraction,
} from './channel-cost-pricing'

// ============================================================================
// Form Validation Schema
// ============================================================================

const SUPPORTED_PROXY_PROTOCOLS = new Set([
  'http:',
  'https:',
  'socks5:',
  'socks5h:',
])

function isOptionalProxyURL(value: string | undefined): boolean {
  const trimmedValue = value?.trim() || ''
  if (!trimmedValue) return true

  const schemeSeparatorIndex = trimmedValue.indexOf('://')
  if (schemeSeparatorIndex <= 0) return false

  const authorityAndSuffix = trimmedValue.slice(schemeSeparatorIndex + 3)
  const suffixIndex = authorityAndSuffix.search(/[/?#]/)
  if (suffixIndex >= 0 && authorityAndSuffix.slice(suffixIndex) !== '/') {
    return false
  }

  try {
    const parsedURL = new URL(trimmedValue)
    return (
      SUPPORTED_PROXY_PROTOCOLS.has(parsedURL.protocol) &&
      Boolean(parsedURL.hostname) &&
      parsedURL.port !== '0'
    )
  } catch {
    return false
  }
}

export const HTTP_PROTOCOL_AUTO = 'auto'
export const HTTP_PROTOCOL_HTTP1 = 'http1'
export const MAX_HTTP2_CONNECTION_SHARDS = 8

export function normalizeHttpProtocol(
  value: string | undefined | null
): 'auto' | 'http1' {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (normalized === HTTP_PROTOCOL_HTTP1) {
    return HTTP_PROTOCOL_HTTP1
  }
  return HTTP_PROTOCOL_AUTO
}

export function normalizeHttp2ConnectionShards(
  value: number | undefined | null
): number {
  if (value == null || Number.isNaN(value) || value === 0) {
    return 1
  }
  if (value < 1) {
    return 1
  }
  if (value > MAX_HTTP2_CONNECTION_SHARDS) {
    return MAX_HTTP2_CONNECTION_SHARDS
  }
  return value
}

function parseOptionalJson(value: string | undefined): unknown {
  if (!value?.trim()) return undefined
  return JSON.parse(value)
}

function isJsonObjectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalJsonObject(value: string | undefined): boolean {
  try {
    const parsed = parseOptionalJson(value)
    return parsed === undefined || isJsonObjectValue(parsed)
  } catch {
    return false
  }
}

// ----------------------------------------------------------------------------
// Sell discount (售价折扣)
// ----------------------------------------------------------------------------

/**
 * Mirror of `dto.ChannelPriceSettings`, stored at `other_settings.price`.
 *
 * No longer edited in the channel drawer: the sell price is now derived from
 * cost × (1 + markup) and the discount against the vendor list price is a
 * computed, read-only column. This type stays because the channels table still
 * reads the stored discount off the list payload, and because the drawer must
 * leave an existing `price` object untouched when it saves — dropping the key
 * would silently reprice every model on the channel.
 */
export interface ChannelPriceSettings {
  discount?: number
  models?: Record<string, number>
  updated_at?: number
}

function isOptionalModelMapping(value: string | undefined): boolean {
  try {
    const parsed = parseOptionalJson(value)
    if (parsed === undefined) return true
    if (!isJsonObjectValue(parsed)) return false
    return Object.values(parsed).every((item) => typeof item === 'string')
  } catch {
    return false
  }
}

function isOptionalStatusCodeMapping(value: string | undefined): boolean {
  try {
    const parsed = parseOptionalJson(value)
    if (parsed === undefined) return true
    if (!isJsonObjectValue(parsed)) return false
    return Object.entries(parsed).every(([from, to]) => {
      const fromCode = Number(from)
      const toCode = Number(to)
      return (
        Number.isInteger(fromCode) &&
        Number.isInteger(toCode) &&
        fromCode >= 100 &&
        fromCode <= 599 &&
        toCode >= 100 &&
        toCode <= 599
      )
    })
  } catch {
    return false
  }
}

function isCodexCredential(value: string | undefined): boolean {
  try {
    const parsed = parseOptionalJson(value)
    if (parsed === undefined) return true
    return (
      isJsonObjectValue(parsed) &&
      typeof parsed.access_token === 'string' &&
      parsed.access_token.trim().length > 0 &&
      typeof parsed.account_id === 'string' &&
      parsed.account_id.trim().length > 0
    )
  } catch {
    return false
  }
}

function isVertexJsonKey(value: string | undefined): boolean {
  try {
    const parsed = parseOptionalJson(value)
    if (parsed === undefined) return true
    if (Array.isArray(parsed)) {
      return parsed.every((item) => isJsonObjectValue(item))
    }
    return isJsonObjectValue(parsed)
  } catch {
    return false
  }
}

function addRequiredIssue(
  ctx: z.RefinementCtx,
  path: string,
  message: string
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    message,
  })
}

export const channelFormSchema = z
  .object({
    name: z.string().min(1, ERROR_MESSAGES.REQUIRED_NAME),
    type: z.number().min(0, ERROR_MESSAGES.REQUIRED_TYPE),
    base_url: z.string().optional(),
    key: z.string(),
    openai_organization: z.string().optional(),
    models: z.string().min(1, ERROR_MESSAGES.REQUIRED_MODELS),
    group: z.array(z.string()).min(1, ERROR_MESSAGES.REQUIRED_GROUP),
    model_mapping: z
      .string()
      .optional()
      .refine(
        isOptionalModelMapping,
        'Model mapping must be a JSON object with string values'
      ),
    priority: z.number().optional(),
    weight: z.number().optional(),
    test_model: z.string().optional(),
    auto_ban: z.number().optional(),
    status: z.number(),
    status_code_mapping: z
      .string()
      .optional()
      .refine(
        isOptionalStatusCodeMapping,
        'Status code mapping must use valid HTTP status codes'
      ),
    tag: z.string().optional(),
    // The short line code customers pin with `<model>/<code>`. Restricted to
    // url-safe characters because it travels inside a model name: a code carrying
    // a slash would split wrong, and one carrying a space would need escaping at
    // every caller.
    line_code: z
      .string()
      .max(32, 'Line code must be less than 32 characters')
      .refine(
        (value) => !value || /^[A-Za-z0-9_-]+$/.test(value),
        'Line code may only contain letters, digits, hyphens and underscores'
      )
      .optional(),
    remark: z
      .string()
      .max(255, 'Remark must be less than 255 characters')
      .optional(),
    setting: z
      .string()
      .optional()
      .refine(isOptionalJsonObject, ERROR_MESSAGES.INVALID_JSON),
    param_override: z
      .string()
      .optional()
      .refine(isOptionalJsonObject, ERROR_MESSAGES.INVALID_JSON),
    header_override: z
      .string()
      .optional()
      .refine(isOptionalJsonObject, ERROR_MESSAGES.INVALID_JSON),
    settings: z
      .string()
      .optional()
      .refine(isOptionalJsonObject, ERROR_MESSAGES.INVALID_JSON),
    advanced_custom: z.string().optional(),
    other: z.string().optional(),
    // Multi-key options (not sent to backend directly)
    multi_key_mode: z.enum(['single', 'batch', 'multi_to_single']).optional(),
    multi_key_type: z.enum(['random', 'polling']).optional(),
    batch_add_set_key_prefix_2_name: z.boolean().optional(),
    key_mode: z.enum(['append', 'replace']).optional(), // For editing multi-key channels
    // Channel extra settings (stored in setting JSON, not sent directly)
    force_format: z.boolean().optional(),
    thinking_to_content: z.boolean().optional(),
    proxy: z
      .string()
      .optional()
      .refine(isOptionalProxyURL, ERROR_MESSAGES.INVALID_PROXY),
    http_protocol: z.enum(['auto', 'http1']).optional(),
    http2_connection_shards: z.number().int().optional(),
    pass_through_body_enabled: z.boolean().optional(),
    system_prompt: z.string().optional(),
    system_prompt_override: z.boolean().optional(),
    // Type-specific settings (stored in settings JSON)
    is_enterprise_account: z.boolean().optional(), // OpenRouter specific
    vertex_key_type: z.enum(['json', 'api_key']).optional(), // Vertex AI specific
    aws_key_type: z.enum(['ak_sk', 'api_key']).optional(), // AWS specific
    azure_responses_version: z.string().optional(), // Azure specific
    // Field passthrough controls (stored in settings JSON)
    allow_service_tier: z.boolean().optional(), // OpenAI/Anthropic
    disable_store: z.boolean().optional(), // OpenAI only
    allow_safety_identifier: z.boolean().optional(), // OpenAI only
    allow_include_obfuscation: z.boolean().optional(), // OpenAI: include usage obfuscation
    allow_inference_geo: z.boolean().optional(), // OpenAI/Anthropic: inference geography
    allow_speed: z.boolean().optional(), // Anthropic: speed mode control
    claude_beta_query: z.boolean().optional(), // Anthropic: beta query passthrough
    disable_task_polling_sleep: z.boolean().optional(),
    // Upstream model update settings (stored in settings JSON)
    upstream_model_update_check_enabled: z.boolean().optional(),
    upstream_model_update_auto_sync_enabled: z.boolean().optional(),
    upstream_model_update_ignored_models: z.string().optional(),
    // Channel pricing (stored in settings JSON under cost). The operator types
    // a markup and per-model buy prices; sell price, discount and margin are
    // derived for display and never stored. cost_json is the escape hatch for
    // the token kinds the table does not show (cache/audio/image/per_call).
    cost_markup_percent: z
      .number()
      .min(0, 'Markup must be 0 or more')
      .max(MAX_MARKUP_PERCENT, 'Markup must be 1000 or less')
      .optional(),
    cost_models: z
      .array(
        z.object({
          model: z.string().min(1, 'Model name is required'),
          input: z.number().min(0).optional(),
          output: z.number().min(0).optional(),
          markup_percent: z
            .number()
            .min(0, 'Markup must be 0 or more')
            .max(MAX_MARKUP_PERCENT, 'Markup must be 1000 or less')
            .optional(),
        })
      )
      .optional(),
    cost_json: z
      .string()
      .optional()
      .refine(isOptionalJsonObject, ERROR_MESSAGES.INVALID_JSON),
  })
  .superRefine((data, ctx) => {
    if (
      [3, 8, 36, 45, CHANNEL_TYPE_NEW_API].includes(data.type) &&
      !data.base_url?.trim()
    ) {
      addRequiredIssue(
        ctx,
        'base_url',
        'Base URL is required for this channel type'
      )
    }

    if (data.type === CHANNEL_TYPE_ADVANCED_CUSTOM) {
      const advancedCustomConfig = parseAdvancedCustomConfig(
        data.advanced_custom
      )
      const advancedCustomError =
        validateAdvancedCustomConfig(advancedCustomConfig)
      if (advancedCustomError) {
        addRequiredIssue(ctx, 'advanced_custom', advancedCustomError.message)
      }
      if (
        advancedCustomConfigUsesRelativeUpstreamPath(advancedCustomConfig) &&
        !data.base_url?.trim()
      ) {
        addRequiredIssue(
          ctx,
          'base_url',
          'Base URL is required when an advanced route uses an upstream path'
        )
      }
      if (
        data.upstream_model_update_check_enabled === true &&
        !hasValidAdvancedCustomModelListRoute(advancedCustomConfig)
      ) {
        addRequiredIssue(
          ctx,
          'upstream_model_update_check_enabled',
          'OpenAI Models route is required to enable upstream model checks'
        )
      }
    }

    if ([3, 18, 21, 39, 41, 49].includes(data.type) && !data.other?.trim()) {
      addRequiredIssue(
        ctx,
        'other',
        'This channel type requires additional configuration'
      )
    }

    if (data.type === 57) {
      if (data.multi_key_mode && data.multi_key_mode !== 'single') {
        addRequiredIssue(
          ctx,
          'multi_key_mode',
          'Codex channels do not support batch creation'
        )
      }
      if (data.key?.trim() && !isCodexCredential(data.key)) {
        addRequiredIssue(
          ctx,
          'key',
          'Codex credential must be a JSON object with access_token and account_id'
        )
      }
    }

    if (
      data.type === 41 &&
      data.vertex_key_type === 'json' &&
      data.key?.trim() &&
      !isVertexJsonKey(data.key)
    ) {
      addRequiredIssue(
        ctx,
        'key',
        'Vertex AI service account key must be valid JSON'
      )
    }

    if (
      data.type === 41 &&
      data.vertex_key_type === 'api_key' &&
      data.multi_key_mode &&
      data.multi_key_mode !== 'single'
    ) {
      addRequiredIssue(
        ctx,
        'multi_key_mode',
        'Vertex AI API Key mode does not support batch creation'
      )
    }

    const protocol = normalizeHttpProtocol(data.http_protocol)
    const shards = data.http2_connection_shards ?? 1
    if (shards < 1 || shards > MAX_HTTP2_CONNECTION_SHARDS) {
      addRequiredIssue(
        ctx,
        'http2_connection_shards',
        ERROR_MESSAGES.INVALID_HTTP2_CONNECTION_SHARDS
      )
    }
    if (protocol === HTTP_PROTOCOL_HTTP1 && shards > 1) {
      addRequiredIssue(
        ctx,
        'http2_connection_shards',
        ERROR_MESSAGES.INVALID_HTTP1_WITH_SHARDS
      )
    }
  })

export type ChannelFormValues = z.infer<typeof channelFormSchema>

// ============================================================================
// Default Form Values
// ============================================================================

export const CHANNEL_FORM_DEFAULT_VALUES: ChannelFormValues = {
  name: '',
  type: 1,
  base_url: '',
  key: '',
  openai_organization: '',
  models: '',
  group: ['default'],
  model_mapping: '',
  priority: 0,
  weight: 0,
  test_model: '',
  auto_ban: 1,
  status: CHANNEL_STATUS.ENABLED,
  status_code_mapping: '',
  tag: '',
  line_code: '',
  remark: '',
  setting: '',
  param_override: '',
  header_override: '',
  settings: '{}',
  other: '',
  multi_key_mode: 'single',
  multi_key_type: 'random',
  batch_add_set_key_prefix_2_name: false,
  key_mode: 'append',
  // Channel extra settings
  force_format: false,
  thinking_to_content: false,
  proxy: '',
  http_protocol: HTTP_PROTOCOL_AUTO,
  http2_connection_shards: 1,
  pass_through_body_enabled: false,
  system_prompt: '',
  system_prompt_override: false,
  // Type-specific settings
  is_enterprise_account: false,
  vertex_key_type: 'json',
  aws_key_type: 'ak_sk',
  azure_responses_version: '',
  // Field passthrough controls
  allow_service_tier: false,
  disable_store: false,
  allow_safety_identifier: false,
  allow_include_obfuscation: false,
  allow_inference_geo: false,
  allow_speed: false,
  claude_beta_query: false,
  disable_task_polling_sleep: false,
  upstream_model_update_check_enabled: false,
  upstream_model_update_auto_sync_enabled: false,
  upstream_model_update_ignored_models: '',
  advanced_custom: '',
  cost_markup_percent: 0,
  cost_models: [],
  cost_json: '',
}

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Transform Channel from API to Form default values
 */
export function transformChannelToFormDefaults(
  channel: Channel
): ChannelFormValues {
  // Parse channel extra settings from setting field
  let extraSettings = {
    force_format: false,
    thinking_to_content: false,
    proxy: '',
    http_protocol: HTTP_PROTOCOL_AUTO as 'auto' | 'http1',
    http2_connection_shards: 1,
    pass_through_body_enabled: false,
    system_prompt: '',
    system_prompt_override: false,
  }

  if (channel.setting) {
    try {
      const parsed = JSON.parse(channel.setting)
      const protocol = normalizeHttpProtocol(parsed.http_protocol)
      const shards = normalizeHttp2ConnectionShards(
        parsed.http2_connection_shards
      )
      extraSettings = {
        force_format: parsed.force_format || false,
        thinking_to_content: parsed.thinking_to_content || false,
        proxy: parsed.proxy || '',
        http_protocol: protocol,
        http2_connection_shards: protocol === HTTP_PROTOCOL_HTTP1 ? 1 : shards,
        pass_through_body_enabled: parsed.pass_through_body_enabled || false,
        system_prompt: parsed.system_prompt || '',
        system_prompt_override: parsed.system_prompt_override || false,
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to parse channel setting:', error)
    }
  }

  // Parse type-specific settings from settings field
  let vertexKeyType: 'json' | 'api_key' = 'json'
  let azureResponsesVersion = ''
  let isEnterpriseAccount = false
  let awsKeyType: 'ak_sk' | 'api_key' = 'ak_sk'
  let allowServiceTier = false
  let disableStore = false
  let allowSafetyIdentifier = false
  let allowIncludeObfuscation = false
  let allowInferenceGeo = false
  let allowSpeed = false
  let claudeBetaQuery = false
  let disableTaskPollingSleep = false
  let upstreamModelUpdateCheckEnabled = false
  let upstreamModelUpdateAutoSyncEnabled = false
  let upstreamModelUpdateIgnoredModels = ''
  let advancedCustom = ''
  let costConfig: ChannelCostSettings | null = null

  if (channel.settings) {
    try {
      const parsed = JSON.parse(channel.settings)
      vertexKeyType = parsed.vertex_key_type || 'json'
      azureResponsesVersion = parsed.azure_responses_version || ''
      isEnterpriseAccount = parsed.openrouter_enterprise === true
      awsKeyType = parsed.aws_key_type || 'ak_sk'
      allowServiceTier = parsed.allow_service_tier === true
      disableStore = parsed.disable_store === true
      allowSafetyIdentifier = parsed.allow_safety_identifier === true
      allowIncludeObfuscation = parsed.allow_include_obfuscation === true
      allowInferenceGeo = parsed.allow_inference_geo === true
      allowSpeed = parsed.allow_speed === true
      claudeBetaQuery = parsed.claude_beta_query === true
      disableTaskPollingSleep = parsed.disable_task_polling_sleep === true
      upstreamModelUpdateCheckEnabled =
        parsed.upstream_model_update_check_enabled === true
      upstreamModelUpdateAutoSyncEnabled =
        parsed.upstream_model_update_auto_sync_enabled === true
      upstreamModelUpdateIgnoredModels = Array.isArray(
        parsed.upstream_model_update_ignored_models
      )
        ? parsed.upstream_model_update_ignored_models.join(',')
        : ''
      if (parsed.advanced_custom) {
        advancedCustom = stringifyAdvancedCustomConfig(parsed.advanced_custom)
      }
      if (
        parsed.cost &&
        typeof parsed.cost === 'object' &&
        !Array.isArray(parsed.cost)
      ) {
        costConfig = parsed.cost as ChannelCostSettings
      }
      // `price` is deliberately not read into the form: it is no longer
      // editable here. `buildSettingsJSON` copies it through untouched.
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to parse channel settings:', error)
    }
  }

  return {
    name: channel.name || '',
    type: channel.type,
    base_url: channel.base_url || '',
    key: '', // Never populate key from backend for security
    openai_organization: channel.openai_organization || '',
    models: channel.models || '',
    group: parseGroups(channel.group || 'default'),
    model_mapping: channel.model_mapping || '',
    priority: channel.priority || 0,
    weight: channel.weight || 0,
    test_model: channel.test_model || '',
    auto_ban: channel.auto_ban ?? 1,
    status: channel.status,
    status_code_mapping: channel.status_code_mapping || '',
    tag: channel.tag || '',
    line_code: channel.line_code || '',
    remark: channel.remark || '',
    setting: channel.setting || '',
    param_override: channel.param_override || '',
    header_override: channel.header_override || '',
    settings: channel.settings || '{}',
    other: channel.other || '',
    multi_key_mode: 'single',
    multi_key_type: channel.channel_info.multi_key_mode || 'random',
    batch_add_set_key_prefix_2_name: false,
    key_mode: 'append', // Default to append mode for editing multi-key channels
    // Channel extra settings
    ...extraSettings,
    // Type-specific settings
    is_enterprise_account: isEnterpriseAccount,
    vertex_key_type: vertexKeyType,
    azure_responses_version: azureResponsesVersion,
    aws_key_type: awsKeyType,
    allow_service_tier: allowServiceTier,
    disable_store: disableStore,
    allow_include_obfuscation: allowIncludeObfuscation,
    allow_inference_geo: allowInferenceGeo,
    allow_speed: allowSpeed,
    claude_beta_query: claudeBetaQuery,
    disable_task_polling_sleep: disableTaskPollingSleep,
    allow_safety_identifier: allowSafetyIdentifier,
    upstream_model_update_check_enabled: upstreamModelUpdateCheckEnabled,
    upstream_model_update_auto_sync_enabled: upstreamModelUpdateAutoSyncEnabled,
    upstream_model_update_ignored_models: upstreamModelUpdateIgnoredModels,
    advanced_custom: advancedCustom,
    ...expandCostConfigToForm(costConfig),
  }
}

/**
 * Build the setting JSON string from form extra settings
 */
export function buildSettingJSON(formData: ChannelFormValues): string {
  const settingObj: Record<string, unknown> = {
    force_format: formData.force_format || false,
    thinking_to_content: formData.thinking_to_content || false,
    proxy: formData.proxy?.trim() || '',
    pass_through_body_enabled: formData.pass_through_body_enabled || false,
    system_prompt: formData.system_prompt || '',
    system_prompt_override: formData.system_prompt_override || false,
  }

  const protocol = normalizeHttpProtocol(formData.http_protocol)
  const shards =
    protocol === HTTP_PROTOCOL_HTTP1
      ? 1
      : normalizeHttp2ConnectionShards(formData.http2_connection_shards)

  // Omit defaults so unchanged channels keep equivalent JSON.
  if (protocol === HTTP_PROTOCOL_HTTP1) {
    settingObj.http_protocol = HTTP_PROTOCOL_HTTP1
  } else if (shards > 1) {
    settingObj.http2_connection_shards = shards
  }

  return JSON.stringify(settingObj)
}

/**
 * Build the settings JSON string (for type-specific config like vertex_key_type)
 */
function buildSettingsJSON(formData: ChannelFormValues): string {
  let settingsObj: Record<string, unknown> = {}

  // Try to parse existing settings first
  if (formData.settings && formData.settings !== '{}') {
    try {
      settingsObj = JSON.parse(formData.settings)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to parse existing settings:', error)
    }
  }

  // Add vertex_key_type for Vertex AI channels (type 41)
  if (formData.type === 41) {
    settingsObj.vertex_key_type = formData.vertex_key_type || 'json'
  } else if ('vertex_key_type' in settingsObj) {
    delete settingsObj.vertex_key_type
  }

  // Add azure_responses_version for Azure channels (type 3)
  if (formData.type === 3 && formData.azure_responses_version) {
    settingsObj.azure_responses_version = formData.azure_responses_version
  } else if ('azure_responses_version' in settingsObj) {
    delete settingsObj.azure_responses_version
  }

  // Add enterprise account setting for OpenRouter (type 20)
  if (formData.type === 20) {
    settingsObj.openrouter_enterprise = formData.is_enterprise_account === true
  } else if ('openrouter_enterprise' in settingsObj) {
    delete settingsObj.openrouter_enterprise
  }

  // Add aws_key_type for AWS channels (type 33)
  if (formData.type === 33) {
    settingsObj.aws_key_type = formData.aws_key_type || 'ak_sk'
  } else if ('aws_key_type' in settingsObj) {
    delete settingsObj.aws_key_type
  }

  // Field passthrough controls:
  // - OpenAI, Anthropic, Codex, and New API: allow_service_tier
  // - OpenAI request fields: OpenAI, Codex, and New API
  // - Claude request fields: Anthropic and New API
  if (FIELD_PASSTHROUGH_TYPES.has(formData.type)) {
    settingsObj.allow_service_tier = formData.allow_service_tier === true
  } else if ('allow_service_tier' in settingsObj) {
    delete settingsObj.allow_service_tier
  }

  if (OPENAI_FIELD_PASSTHROUGH_TYPES.has(formData.type)) {
    settingsObj.disable_store = formData.disable_store === true
    settingsObj.allow_safety_identifier =
      formData.allow_safety_identifier === true
    settingsObj.allow_include_obfuscation =
      formData.allow_include_obfuscation === true
  } else {
    if ('disable_store' in settingsObj) {
      delete settingsObj.disable_store
    }
    if ('allow_safety_identifier' in settingsObj) {
      delete settingsObj.allow_safety_identifier
    }
    if ('allow_include_obfuscation' in settingsObj) {
      delete settingsObj.allow_include_obfuscation
    }
  }

  if (
    OPENAI_FIELD_PASSTHROUGH_TYPES.has(formData.type) ||
    CLAUDE_FIELD_PASSTHROUGH_TYPES.has(formData.type)
  ) {
    settingsObj.allow_inference_geo = formData.allow_inference_geo === true
  } else if ('allow_inference_geo' in settingsObj) {
    delete settingsObj.allow_inference_geo
  }

  if (CLAUDE_FIELD_PASSTHROUGH_TYPES.has(formData.type)) {
    settingsObj.allow_speed = formData.allow_speed === true
  } else if ('allow_speed' in settingsObj) {
    delete settingsObj.allow_speed
  }

  // Only the Anthropic adaptor supports forcing the Claude beta query.
  if (formData.type === 14) {
    settingsObj.claude_beta_query = formData.claude_beta_query === true
  } else if ('claude_beta_query' in settingsObj) {
    delete settingsObj.claude_beta_query
  }

  settingsObj.disable_task_polling_sleep =
    formData.disable_task_polling_sleep === true

  // Upstream model update settings (for model-fetchable channel types)
  if (MODEL_FETCHABLE_TYPES.has(formData.type)) {
    settingsObj.upstream_model_update_check_enabled =
      formData.upstream_model_update_check_enabled === true
    settingsObj.upstream_model_update_auto_sync_enabled =
      settingsObj.upstream_model_update_check_enabled === true &&
      formData.upstream_model_update_auto_sync_enabled === true
    settingsObj.upstream_model_update_ignored_models = [
      ...new Set(
        String(formData.upstream_model_update_ignored_models || '')
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean)
      ),
    ]
    if (
      !Array.isArray(settingsObj.upstream_model_update_last_detected_models) ||
      settingsObj.upstream_model_update_check_enabled !== true
    ) {
      settingsObj.upstream_model_update_last_detected_models = []
    }
    if (typeof settingsObj.upstream_model_update_last_check_time !== 'number') {
      settingsObj.upstream_model_update_last_check_time = 0
    }
  }

  if (formData.type === CHANNEL_TYPE_ADVANCED_CUSTOM) {
    const advancedCustomConfig = parseAdvancedCustomConfig(
      formData.advanced_custom
    )
    if (advancedCustomConfig) {
      settingsObj.advanced_custom = advancedCustomConfig
    }
  } else if ('advanced_custom' in settingsObj) {
    delete settingsObj.advanced_custom
  }

  // Channel pricing: structured fields win; raw JSON is the escape hatch for
  // the token kinds the table does not expose (cache/audio/image/per_call).
  // When the raw JSON has content it is submitted verbatim.
  const costFromJson = parseOptionalOverrideJSON(formData.cost_json)
  const structuredCost = buildCostFromStructuredFields(formData)
  if (costFromJson) {
    settingsObj.cost = costFromJson
  } else if (structuredCost) {
    settingsObj.cost = structuredCost
  } else if ('cost' in settingsObj) {
    delete settingsObj.cost
  }

  // `price` is left exactly as it was found. It is no longer editable in this
  // drawer, and `settingsObj` starts as a copy of the stored settings, so an
  // existing sell discount survives a save untouched. Deleting the key here
  // would drop every channel back onto legacy modelRatio × group_ratio billing
  // the first time anyone opened the drawer and hit save.

  return JSON.stringify(settingsObj)
}

// parseOptionalOverrideJSON returns the parsed object or null when the raw JSON
// is empty/invalid. Invalid JSON is blocked by the schema refine; here it
// degrades to "no override" so the structured fields still apply. Shared by the
// cost and price escape hatches, which have the same semantics.
function parseOptionalOverrideJSON(
  raw: string | undefined
): Record<string, unknown> | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

// buildCostFromStructuredFields assembles the cost object from the everyday
// form fields. Returns null when nothing is configured so the stored `cost`
// key is removed and the channel falls back to default tiers.
function buildCostFromStructuredFields(
  formData: ChannelFormValues
): Record<string, unknown> | null {
  const markup = formData.cost_markup_percent ?? 0
  const models = (formData.cost_models ?? []).filter((row) => row.model?.trim())

  const hasMarkup = markup > 0
  const hasModels = models.length > 0
  if (!hasMarkup && !hasModels) {
    return null
  }

  const cost: Record<string, unknown> = {}
  if (hasMarkup) {
    // Form holds percent (30 = 30%); storage is a fraction (0.3).
    cost.default_markup = markupPercentToFraction(markup)
  }
  if (hasModels) {
    const modelMap: Record<string, Record<string, number>> = {}
    for (const row of models) {
      const entry: Record<string, number> = {}
      if (row.input != null && row.input >= 0) entry.input = row.input
      if (row.output != null && row.output >= 0) entry.output = row.output
      // 0 is a legal per-model markup ("sell this one at cost"), so the guard
      // is `>= 0`, not truthiness: a falsy check would drop it and silently
      // reprice the model at the channel markup instead.
      if (row.markup_percent != null && row.markup_percent >= 0) {
        entry.markup = markupPercentToFraction(row.markup_percent)
      }
      modelMap[row.model.trim()] = entry
    }
    cost.models = modelMap
  }
  return cost
}

/**
 * Keys the structured table round-trips losslessly. `mode`, `discount` and
 * `expr` are gone from the contract but still sit in settings saved by the
 * previous form, so they are listed as tolerated-and-dropped: treating them as
 * unknown would strand every already-configured channel in the raw JSON box
 * with an empty table, which reads as data loss.
 */
const STRUCTURED_COST_KEYS = new Set([
  'default_markup',
  'models',
  'currency',
  'updated_at',
  'mode',
  'discount',
  'expr',
])

const STRUCTURED_COST_MODEL_KEYS = new Set(['input', 'output', 'markup'])

// expandCostConfigToForm flattens a stored cost object into the structured
// form fields (percent round-trip: 0.3 → 30).
function expandCostConfigToForm(
  cost: ChannelCostSettings | null
): Pick<
  ChannelFormValues,
  'cost_markup_percent' | 'cost_models' | 'cost_json'
> {
  if (!cost) {
    return {
      cost_markup_percent: 0,
      cost_models: [],
      cost_json: '',
    }
  }
  const markup =
    typeof cost.default_markup === 'number' && cost.default_markup > 0
      ? markupFractionToPercent(cost.default_markup)
      : 0
  const models = Object.entries(cost.models ?? {}).map(([model, price]) => ({
    model,
    input: typeof price?.input === 'number' ? price.input : undefined,
    output: typeof price?.output === 'number' ? price.output : undefined,
    markup_percent:
      typeof price?.markup === 'number' && price.markup >= 0
        ? markupFractionToPercent(price.markup)
        : undefined,
  }))
  const usesOnlyStructuredFields =
    Object.keys(cost).every((key) => STRUCTURED_COST_KEYS.has(key)) &&
    (cost.default_markup == null || typeof cost.default_markup === 'number') &&
    Object.values(cost.models ?? {}).every(
      (price) =>
        price &&
        Object.keys(price).every((key) => STRUCTURED_COST_MODEL_KEYS.has(key))
    )
  // A model priced per cache/audio/image kind stays in the raw JSON box so the
  // table cannot silently drop the kinds it does not show.
  const json = usesOnlyStructuredFields ? '' : JSON.stringify(cost, null, 2)
  return {
    cost_markup_percent: markup,
    cost_models: models,
    cost_json: json,
  }
}

/**
 * The sell discount a channel currently has stored, read straight off the
 * `other_settings` JSON the list endpoint already returns — no extra request.
 *
 * `discount` stays a 0-1 fraction so callers can hand it to `formatDiscount`,
 * which renders 折 or "% off" per locale. `modelOverrides` counts the per-model
 * entries, which a single table cell cannot enumerate but should not hide
 * either: a channel whose default is unset can still be discounting models.
 */
export function readChannelSellDiscount(
  settingsStr: string | null | undefined
): { discount: number | null; modelOverrides: number } {
  const empty = { discount: null, modelOverrides: 0 }
  if (!settingsStr || settingsStr === '{}') return empty

  try {
    const parsed = JSON.parse(settingsStr)
    const price = parsed?.price
    if (!price || typeof price !== 'object' || Array.isArray(price)) {
      return empty
    }
    const raw = (price as ChannelPriceSettings).discount
    const models = (price as ChannelPriceSettings).models
    return {
      discount:
        typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null,
      modelOverrides: models ? Object.keys(models).length : 0,
    }
  } catch {
    return empty
  }
}

function normalizeBaseUrl(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
}

/**
 * Transform form data to API payload for creating channel
 */
export function transformFormDataToCreatePayload(formData: ChannelFormValues): {
  mode: 'single' | 'batch' | 'multi_to_single'
  multi_key_mode?: 'random' | 'polling'
  batch_add_set_key_prefix_2_name?: boolean
  channel: Partial<Channel>
} {
  const mode = formData.multi_key_mode || 'single'

  const channel: Partial<Channel> = {
    name: formData.name,
    type: formData.type,
    base_url: normalizeBaseUrl(formData.base_url) || null,
    key: formData.key,
    openai_organization: formData.openai_organization || null,
    models: formData.models,
    group: formatGroups(formData.group),
    model_mapping: formData.model_mapping || null,
    priority: formData.priority || null,
    weight: formData.weight || null,
    test_model: formData.test_model || null,
    auto_ban: formData.auto_ban ?? 1,
    status: formData.status,
    status_code_mapping: formData.status_code_mapping || null,
    tag: formData.tag || null,
    line_code: formData.line_code?.trim() || null,
    remark: formData.remark || '',
    setting: buildSettingJSON(formData),
    param_override: formData.param_override || null,
    header_override: formData.header_override || null,
    settings: buildSettingsJSON(formData),
    other: formData.other || '',
  }

  // Clean up empty strings to null for optional fields
  Object.keys(channel).forEach((key) => {
    if (channel[key as keyof typeof channel] === '') {
      ;(channel as Record<string, unknown>)[key] = null
    }
  })

  return {
    mode,
    multi_key_mode:
      mode === 'multi_to_single' ? formData.multi_key_type : undefined,
    batch_add_set_key_prefix_2_name:
      mode === 'batch' ? formData.batch_add_set_key_prefix_2_name : undefined,
    channel,
  }
}

/**
 * Transform form data to API payload for updating channel
 */
export function transformFormDataToUpdatePayload(
  formData: ChannelFormValues,
  channelId: number
): Partial<Channel> {
  const payload: Partial<Channel> = {
    id: channelId,
    name: formData.name,
    type: formData.type,
    base_url: normalizeBaseUrl(formData.base_url) || null,
    openai_organization: formData.openai_organization || null,
    models: formData.models,
    group: formatGroups(formData.group),
    model_mapping: formData.model_mapping || null,
    priority: formData.priority ?? 0,
    weight: formData.weight ?? 0,
    test_model: formData.test_model || null,
    auto_ban: formData.auto_ban ?? 1,
    status_code_mapping: formData.status_code_mapping || null,
    tag: formData.tag || null,
    remark: formData.remark || '',
    setting: buildSettingJSON(formData),
    param_override: formData.param_override || null,
    header_override: formData.header_override || null,
    settings: buildSettingsJSON(formData),
    other: formData.other || '',
  }

  // Only include key if it was changed (not empty)
  if (formData.key && formData.key.trim()) {
    payload.key = formData.key
  }

  // Clean up empty strings to null for optional fields
  Object.keys(payload).forEach((key) => {
    if (payload[key as keyof typeof payload] === '') {
      ;(payload as Record<string, unknown>)[key] = null
    }
  })

  // Send explicit empty strings for nullable fields so GORM updates can clear them.
  payload.base_url = normalizeBaseUrl(formData.base_url) || ''
  payload.openai_organization = formData.openai_organization || ''
  payload.test_model = formData.test_model || ''
  payload.tag = formData.tag || ''
  // Explicit empty string, same as tag: clearing a line code has to reach the
  // server as a value, or the channel keeps publishing a line the operator just
  // removed and `<model>/<code>` keeps resolving to it.
  payload.line_code = formData.line_code?.trim() || ''
  payload.remark = formData.remark || ''
  payload.model_mapping = formData.model_mapping || ''
  payload.status_code_mapping = formData.status_code_mapping || ''
  payload.param_override = formData.param_override || ''
  payload.header_override = formData.header_override || ''

  return payload
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate JSON string
 */
export function validateJSON(value: string): boolean {
  if (!value || value.trim() === '') return true
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

/**
 * Validate model mapping format
 */
export function validateModelMapping(value: string): boolean {
  if (!value || value.trim() === '') return true
  return validateJSON(value)
}

/**
 * Parse models string to array
 */
export function parseModels(models: string): string[] {
  if (!models) return []
  return models
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
}

/**
 * Parse groups string to array
 */
export function parseGroups(groups: string): string[] {
  if (!groups) return []
  return groups
    .split(',')
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
}

/**
 * Format models array to string
 */
export function formatModels(models: string[]): string {
  return models.join(',')
}

/**
 * Format groups array to string
 */
export function formatGroups(groups: string[]): string {
  return groups.join(',')
}
