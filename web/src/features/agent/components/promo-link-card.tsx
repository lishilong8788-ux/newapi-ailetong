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
import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

import { useAgent } from './agent-provider'

const PROMO_LINK_INPUT_ID = 'agent-promo-link'

export function PromoLinkCard() {
  const { t } = useTranslation()
  const { overview, isLoadingOverview } = useAgent()

  const promoLink = overview?.promo_link ?? ''
  const affCode = overview?.aff_code ?? ''

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='space-y-3 p-4'>
        <div className='flex items-center gap-2.5'>
          <IconBadge tone='chart-3'>
            <Share2 />
          </IconBadge>
          <div className='min-w-0'>
            <h3 className='text-sm font-semibold'>{t('Promo Link')}</h3>
            <p className='text-muted-foreground text-xs'>
              {t('Anyone signing up through this link becomes your customer.')}
            </p>
          </div>
        </div>

        {isLoadingOverview && !overview ? (
          <Skeleton className='h-9' />
        ) : (
          <div className='space-y-2'>
            <Label htmlFor={PROMO_LINK_INPUT_ID} className='sr-only'>
              {t('Promo Link')}
            </Label>
            <div className='flex items-center gap-2'>
              <Input
                id={PROMO_LINK_INPUT_ID}
                value={promoLink}
                readOnly
                className='bg-muted/40 h-9 min-w-0 flex-1 font-mono text-xs'
              />
              <CopyButton
                value={promoLink}
                variant='outline'
                className='size-9 shrink-0'
                iconClassName='size-4'
                tooltip={t('Copy promo link')}
                aria-label={t('Copy promo link')}
              />
            </div>
            {affCode && (
              <p className='text-muted-foreground text-xs'>
                {t('Referral code')}:{' '}
                <span className='font-mono'>{affCode}</span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
