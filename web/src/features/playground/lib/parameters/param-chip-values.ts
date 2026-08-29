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
 * Value handling for the composer's parameter chips.
 *
 * Chip state is deliberately in-memory only — see `ParamChipValues` — and these
 * helpers are what the chip bar uses to decide what a chip currently reads as.
 */
import type { ParamChipSpec } from '../capability'

/**
 * Chip selections, keyed by `ParamChipSpec.id`.
 *
 * Not persisted, and that is intentional rather than unfinished. The image
 * `aspect_ratio` chip does reach the request body (`resolveImageSize`), but a
 * reload clears the generation it applied to, so a restored ratio would describe
 * an image no longer on screen. The remaining chips are still presentational
 * until their modality's relay route opens; persist each one alongside its
 * request-body wiring rather than ahead of it.
 */
export type ParamChipValues = Record<string, string>

/**
 * The value a chip falls back to when the user has not touched it: its first
 * option, which every spec orders as the recommended default.
 */
export function getChipDefaultValue(spec: ParamChipSpec): string | undefined {
  return spec.options?.[0]?.value
}

/**
 * The value a chip should currently display.
 */
export function getChipValue(
  spec: ParamChipSpec,
  values: ParamChipValues
): string | undefined {
  return values[spec.id] ?? getChipDefaultValue(spec)
}

/**
 * The label shown on the chip face.
 *
 * A custom value has no matching option, so it renders as itself — that is the
 * point of `customInput`, and falling back to the default's label would tell the
 * user their input was ignored.
 */
export function getChipValueLabel(
  spec: ParamChipSpec,
  values: ParamChipValues
): string | undefined {
  const value = getChipValue(spec, values)
  if (value === undefined) return undefined

  return spec.options?.find((option) => option.value === value)?.label ?? value
}

/**
 * Whether the chip is holding something other than its default, which is what
 * earns it the highlighted treatment.
 */
export function isChipModified(
  spec: ParamChipSpec,
  values: ParamChipValues
): boolean {
  const current = values[spec.id]
  if (current === undefined) return false

  return current !== getChipDefaultValue(spec)
}

/**
 * Validates free-form chip input.
 *
 * Every chip exposing `customInput` today takes a positive number — a batch
 * count, a duration in seconds, a speaking rate — so a blank, non-numeric, zero
 * or negative entry is rejected rather than silently coerced. Returning the
 * normalised string keeps `"03"` and `" 3 "` from reading as distinct values
 * from the `"3"` option and losing the tick next to it.
 */
export function normalizeChipCustomValue(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null

  return String(parsed)
}
