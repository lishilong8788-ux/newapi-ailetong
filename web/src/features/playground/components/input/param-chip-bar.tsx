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
import type { PlaygroundCapability } from '../../lib/capability'
import type { ParamChipValues } from '../../lib/parameters/param-chip-values'
import { ParamChip } from './param-chip'

type ParamChipBarProps = {
  capability: PlaygroundCapability
  values: ParamChipValues
  onChange: (id: string, value: string) => void
  disabled?: boolean
}

/**
 * Renders a modality's parameter chips in registry order.
 *
 * Chat contributes none — see `CHAT_CAPABILITY`. Image wires `aspect_ratio` into
 * the request body via `resolveImageSize`; its remaining chips, and every chip on
 * the modalities whose relay routes are still closed, are presentational.
 * Rendering them regardless is deliberate — it shows what a capability will offer
 * — and the request-body wiring lands with each modality as it opens. See
 * `ParamChipValues` for why the values are not persisted.
 */
export function ParamChipBar({
  capability,
  values,
  onChange,
  disabled,
}: ParamChipBarProps) {
  if (capability.params.length === 0) return null

  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      {capability.params.map((spec) => (
        <ParamChip
          key={spec.id}
          spec={spec}
          values={values}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  )
}
