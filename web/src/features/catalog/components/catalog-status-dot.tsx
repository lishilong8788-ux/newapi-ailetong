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
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { CATALOG_STATUS_META } from '../lib/catalog-status'
import type { CatalogStatus } from '../types'

/**
 * The state marker for one catalog entry.
 *
 * The dot carries a tooltip and an accessible label rather than standing on
 * colour alone: four states in three hues is already at the limit of what colour
 * can distinguish, and two of them (`blocked`, `out_of_stock`) are the ones an
 * operator most needs to tell apart.
 */
export function CatalogStatusDot(props: {
  status: CatalogStatus
  className?: string
}) {
  const { t } = useTranslation()
  const meta = CATALOG_STATUS_META[props.status]
  const label = t(meta.labelKey)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={label}
            className={cn(
              'size-2.5 shrink-0 rounded-full',
              meta.dotClass,
              props.className
            )}
          />
        }
      />
      <TooltipContent>
        <p className='font-medium'>{label}</p>
        <p className='text-muted-foreground max-w-56 text-[13px]'>
          {t(meta.descriptionKey)}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
