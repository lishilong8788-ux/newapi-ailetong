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

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { DORMANT_THRESHOLD_DAYS } from '../constants'
import { daysSince, formatCommissionDate, isDormant } from '../lib'

/** Right-alignable figure cell: monospaced and tabular so columns line up. */
export function MetricCell(props: { value: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        'font-mono text-sm tabular-nums',
        props.muted && 'text-muted-foreground'
      )}
    >
      {props.value}
    </span>
  )
}

/**
 * Last-commission cell — the actionable signal on the detail table.
 *
 * Design doc 11.4: more than 60 days without a new commission puts an agent on
 * the operations follow-up list, so the date carries a badge rather than sitting
 * as one more number an operator has to date-subtract in their head. Agents that
 * have never earned are called out separately: that is an onboarding gap, not a
 * re-activation one, and the two need different follow-up.
 */
export function LastCommissionCell(props: {
  timestamp: number
  nowSeconds: number
}) {
  const { t } = useTranslation()
  const formatted = formatCommissionDate(props.timestamp)

  if (!formatted) {
    return (
      <Badge variant='outline' className='text-muted-foreground font-normal'>
        {t('Never')}
      </Badge>
    )
  }

  if (!isDormant(props.timestamp, props.nowSeconds)) {
    return <MetricCell value={formatted} />
  }

  const elapsed = daysSince(props.timestamp, props.nowSeconds)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className='inline-flex items-center gap-1.5'>
            <span className='text-warning font-mono text-sm tabular-nums'>
              {formatted}
            </span>
            <Badge variant='warning'>{t('Dormant')}</Badge>
          </span>
        }
      />
      <TooltipContent>
        {t('No commission for {{days}} days — due for a follow-up', {
          days: elapsed ?? DORMANT_THRESHOLD_DAYS,
        })}
      </TooltipContent>
    </Tooltip>
  )
}
