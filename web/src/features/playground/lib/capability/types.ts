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

/**
 * Capability descriptors drive the whole playground surface: picking a model
 * decides which canvas renders, where uploads go, which parameter chips show
 * up, and how the cost is quoted. Adding a modality should mean adding a row to
 * the registry, not writing another page.
 *
 * Naming note: `pricing/types.ts` already exports `Modality` (a model's
 * input/output media types) and `ModelCapability` (feature flags such as
 * `function_calling`). Those are different concepts from the *task* modality
 * modelled here, so these types carry a `Playground` prefix to keep the two
 * vocabularies apart.
 */

/** The task a model performs, which is what users actually pick by. */
export type PlaygroundModality = 'chat' | 'image' | 'video' | 'audio'

/** Which main-area renderer a modality needs. */
export type CanvasKind =
  | 'conversation'
  | 'gallery'
  | 'video-list'
  | 'audio-list'

/**
 * Where a modality puts user-supplied media. `null` means the composer takes
 * text only.
 */
export type UploadSpec =
  | { kind: 'attachments'; max: number }
  /** `label` is an i18next key. */
  | { kind: 'reference-slot'; label: string; max: number }
  | { kind: 'voice-picker' }
  | null

/**
 * A single option inside a parameter popover.
 *
 * `label` and `hint` are English source strings used as i18next keys, per the
 * project convention. The registry is plain data with no React context, so the
 * rendering component is what resolves them through `t()`.
 */
export type ParamOption = {
  value: string
  label: string
  /** Secondary line shown under the label, e.g. a concrete pixel size. */
  hint?: string
}

/**
 * One inline chip in the composer footer. The chip always renders the current
 * value so users never have to open a panel to see how they are configured.
 *
 * `label` and `description` are i18next keys — see `ParamOption`.
 */
export type ParamChipSpec = {
  id: string
  /** Lucide icon name, resolved by the chip component. */
  icon: string
  label: string
  /** Explanatory paragraph shown at the top of the popover. */
  description?: string
  options?: ParamOption[]
  /** Renders a free-form input plus a confirm button below the options. */
  customInput?: boolean
}

/** How usage is quoted to the user for this modality. */
export type BillingSpec = {
  unit: 'token' | 'call' | 'second' | 'char'
  /** Extra clarification (i18next key), e.g. how CJK characters are counted. */
  note?: string
}

/** The full descriptor a modality resolves to. */
export type PlaygroundCapability = {
  modality: PlaygroundModality
  canvas: CanvasKind
  /**
   * Long-running modalities submit a job instead of streaming a reply, which
   * also flips the header button from "new chat" to "task list".
   */
  async: boolean
  /** Relay path used to submit work. */
  endpoint: string
  upload: UploadSpec
  /**
   * Left-edge icon rail in the composer, e.g. text-to-image vs. inpainting.
   * `label` is an i18next key.
   */
  submodes?: Array<{ id: string; icon: string; label: string }>
  /** Array order is render order. */
  params: ParamChipSpec[]
  billing: BillingSpec
  /**
   * False while the relay route for this modality is not reachable from the
   * browser yet, so the UI can show the model but explain it is not open.
   */
  available: boolean
  /**
   * Whether `endpoint` is actually served by the backend.
   *
   * Distinct from `available`, and the two are not redundant: `routed: false`
   * means the path 404s, so a model of this modality can never do anything and
   * is filtered out of the library entirely. `available: false` with
   * `routed: true` means the route exists but the client side is unverified —
   * the model stays listed and carries the "coming soon" badge.
   *
   * Checked against `router/relay-router.go`, where the `/pg` group registers
   * `chat/completions` and `images/generations` only.
   */
  routed: boolean
}
