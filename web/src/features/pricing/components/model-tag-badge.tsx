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

import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'

import { DEFAULT_TAG_VARIANT, TAG_VARIANTS } from '../constants'

export interface ModelTagBadgeProps {
  tag: string
  size?: 'sm' | 'md' | 'lg'
  filled?: boolean
  className?: string
}

/**
 * Renders one operational tag from `models.tags`.
 *
 * Known tags get a color from `TAG_VARIANTS`; unknown ones stay neutral so that
 * operators can introduce new tags without a frontend change.
 */
export const ModelTagBadge = memo(function ModelTagBadge(
  props: ModelTagBadgeProps
) {
  const variant = TAG_VARIANTS[props.tag.toLowerCase()] ?? DEFAULT_TAG_VARIANT

  return (
    <StatusBadge
      label={props.tag}
      variant={variant}
      size={props.size ?? 'sm'}
      copyable={false}
      filled={props.filled}
      className={cn('shrink-0', props.className)}
    />
  )
})
