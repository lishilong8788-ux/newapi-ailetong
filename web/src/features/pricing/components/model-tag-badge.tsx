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
import { memo } from 'react'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { cn } from '@/lib/utils'

export interface ModelTagBadgeProps {
  /** Display name, already resolved from the raw `models.tags` value. */
  label: string
  variant: StatusVariant
  size?: 'sm' | 'md' | 'lg'
  filled?: boolean
  className?: string
}

/**
 * Renders one operational tag from `models.tags`.
 *
 * Takes an already-resolved label and colour rather than the raw tag: resolution
 * (`resolveTagList`) runs once per list, so every badge in a row shares one
 * registry lookup instead of repeating it.
 *
 * The props stay primitives on purpose. Handing the whole `ResolvedTag` down
 * would defeat the `memo` wrapper, because the resolver returns a fresh object
 * on every render and shallow comparison would never hit.
 */
export const ModelTagBadge = memo(function ModelTagBadge(
  props: ModelTagBadgeProps
) {
  return (
    <StatusBadge
      label={props.label}
      variant={props.variant}
      size={props.size ?? 'sm'}
      copyable={false}
      filled={props.filled}
      className={cn('shrink-0', props.className)}
    />
  )
})
