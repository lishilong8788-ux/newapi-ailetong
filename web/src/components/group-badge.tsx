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

import { formatDiscount } from '@/lib/format'
import { cn } from '@/lib/utils'

import { StatusBadge, type StatusBadgeProps } from './status-badge'

/**
 * How the group ratio is rendered next to the badge.
 * - `multiplier` — `0.79x`, the raw billing factor. Correct for admin surfaces
 *   (key management, channel config) where the number is the actual multiplier.
 * - `discount` — `7.9折`, the customer-facing equivalent. Only meaningful for
 *   ratios below 1; at or above 1 it falls back to the multiplier, because
 *   "10折" reads as no discount and above 1 is a surcharge, not a discount.
 */
export type GroupRatioDisplay = 'multiplier' | 'discount'

type GroupBadgeProps = Omit<
  StatusBadgeProps,
  'autoColor' | 'label' | 'variant'
> & {
  group?: string | null
  label?: string
  ratio?: number | null
  /**
   * Group description (e.g. "公有云") rendered as a prefix before the group
   * key. On the pricing page this comes from the `usable_group` map, whose
   * values are plain description strings.
   */
  desc?: string | null
  ratioDisplay?: GroupRatioDisplay
}

function getGroupRatioClassName(ratio: number): string {
  if (ratio > 1) {
    // A surcharge is a warning, not a deal.
    return 'bg-warning/15 text-warning'
  }
  if (ratio < 1) {
    // Discounts read warm so they pull the eye the way a price cut should, and
    // so they match the discount column in the pricing card's price table.
    return 'bg-orange-500/12 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400'
  }
  return 'bg-muted text-muted-foreground'
}

function getGroupLabel(params: {
  labelOverride?: string
  groupName?: string
  desc?: string | null
  isAutoGroup: boolean
  isEmptyGroup: boolean
  t: (key: string) => string
}): string {
  if (params.labelOverride) return params.labelOverride
  if (params.isEmptyGroup) return params.t('User Group')
  if (params.isAutoGroup) return params.t('Auto')
  const groupName = params.groupName ?? ''
  const desc = params.desc?.trim()
  // Skip a description that merely repeats the key, which would render "jd6 · jd6".
  if (desc && desc !== groupName) {
    return `${desc} · ${groupName}`
  }
  return groupName
}

export function GroupBadge(props: GroupBadgeProps) {
  const { t } = useTranslation()
  const {
    group,
    label: labelOverride,
    ratio,
    desc,
    ratioDisplay = 'multiplier',
    copyable = false,
    showDot,
    className,
    ...badgeProps
  } = props
  const groupName = group?.trim()
  const isAutoGroup = groupName === 'auto'
  const isEmptyGroup = !groupName
  const isSpecialGroup = isAutoGroup || isEmptyGroup
  const label = getGroupLabel({
    labelOverride,
    groupName,
    desc,
    isAutoGroup,
    isEmptyGroup,
    t,
  })

  const badge = (
    <StatusBadge
      {...badgeProps}
      copyable={copyable}
      label={label}
      showDot={showDot ?? (isSpecialGroup ? false : undefined)}
      variant={isSpecialGroup ? 'neutral' : undefined}
      autoColor={isSpecialGroup ? undefined : groupName}
      className={cn('min-w-0 shrink overflow-hidden', className)}
    />
  )

  if (ratio == null) {
    return badge
  }

  const showAsDiscount = ratioDisplay === 'discount' && ratio > 0 && ratio < 1
  const ratioText = showAsDiscount ? formatDiscount(ratio, t) : `${ratio}x`

  return (
    <span className='inline-flex max-w-full min-w-0 items-center gap-2 text-xs'>
      <span className='max-w-full min-w-0 overflow-hidden'>{badge}</span>
      <span
        className={cn(
          'inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-xs leading-none font-semibold tabular-nums',
          // Discounts read as prose, so they keep the UI font; multipliers stay
          // monospaced to align across rows in admin tables.
          !showAsDiscount && 'font-mono',
          getGroupRatioClassName(ratio)
        )}
        title={showAsDiscount ? `${ratio}x` : undefined}
      >
        <span>{ratioText}</span>
      </span>
    </span>
  )
}
