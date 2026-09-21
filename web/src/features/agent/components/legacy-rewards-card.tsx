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
import { useQuery } from '@tanstack/react-query'
import { Gift } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { useAffiliate } from '@/features/wallet/hooks'
import { formatQuota } from '@/lib/format'
import { selfQueryOptions } from '@/lib/self-query'

/** The sign-up reward figures on `/api/user/self`, in quota units. */
type LegacyRewards = {
  aff_quota?: number
  aff_history_quota?: number
  aff_count?: number
}

const HEADING_ID = 'agent-legacy-rewards-heading'

function RewardFigure(props: { label: string; value: string }) {
  return (
    <div>
      <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
        {props.label}
      </div>
      <div className='mt-0.5 truncate text-sm font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

/**
 * Leftover balance from the old sign-up-reward scheme, and the way to move it
 * out.
 *
 * This is *not* agent commission: rewards are quota granted for a registration,
 * commission is RMB from a top-up, and the two are separate ledgers. The card
 * therefore renders only while there is a non-zero balance to clear — showing an
 * empty second earnings box next to the commission cards would just invite the
 * two to be read as one number.
 *
 * The figures come from `/api/user/self` rather than the auth store because the
 * store's copy is only as fresh as the last login.
 */
export function LegacyRewardsCard() {
  const { t } = useTranslation()
  const [isTransferOpen, setIsTransferOpen] = useState(false)
  // `fetchCode` off: the promo link on this page is the agent one, issued only
  // after review, and `GET /api/user/aff` would mint a competing code for anyone
  // who asks. Only the transfer half of the hook is wanted here.
  const { transferQuota, transferring } = useAffiliate({ fetchCode: false })

  const { data: rewards, refetch } = useQuery(
    selfQueryOptions<LegacyRewards>()
  )

  const available = rewards?.aff_quota ?? 0
  if (available <= 0) return null

  const handleTransfer = async (quota: number) => {
    const success = await transferQuota(quota)
    if (success) await refetch()
    return success
  }

  return (
    <>
      <Card data-card-hover='false' className='py-0'>
        <CardContent className='space-y-3 p-4'>
          <section aria-labelledby={HEADING_ID} className='space-y-3'>
            <div className='flex items-center gap-2.5'>
              <IconBadge tone='chart-4'>
                <Gift />
              </IconBadge>
              <div className='min-w-0'>
                <h3 id={HEADING_ID} className='text-sm font-semibold'>
                  {t('Sign-up Rewards')}
                </h3>
                <p className='text-muted-foreground text-xs leading-5'>
                  {t(
                    'Quota you earned from the older invite scheme. Separate from agent commission — transfer it to your balance anytime.'
                  )}
                </p>
              </div>
            </div>

            <div className='grid grid-cols-3 gap-2 border-t pt-3'>
              <RewardFigure label={t('Pending')} value={formatQuota(available)} />
              <RewardFigure
                label={t('Total Earned')}
                value={formatQuota(rewards?.aff_history_quota ?? 0)}
              />
              <RewardFigure
                label={t('Invites')}
                value={String(rewards?.aff_count ?? 0)}
              />
            </div>

            <Button
              variant='outline'
              size='sm'
              className='w-full'
              onClick={() => setIsTransferOpen(true)}
            >
              {t('Transfer to Balance')}
            </Button>
          </section>
        </CardContent>
      </Card>

      <TransferDialog
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        onConfirm={handleTransfer}
        availableQuota={available}
        transferring={transferring}
      />
    </>
  )
}
