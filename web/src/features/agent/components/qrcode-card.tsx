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
import { Download, QrCode } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'

import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import { useAgent } from './agent-provider'

const QR_SIZE = 176

/**
 * Sign-up QR code, drawn in the browser.
 *
 * There is no backend endpoint for this on purpose (design doc §7.3): the code
 * encodes a link that is already public, so a round trip would buy nothing and
 * cost a request plus server CPU. Downloading reads the same canvas back out as
 * a PNG.
 */
export function QrcodeCard() {
  const { t } = useTranslation()
  const { overview, isLoadingOverview } = useAgent()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const promoLink = overview?.promo_link ?? ''
  const affCode = overview?.aff_code ?? ''

  const handleDownload = () => {
    const canvas = canvasRef.current
    if (!canvas) {
      toast.error(t(ERROR_MESSAGES.QRCODE_DOWNLOAD_FAILED))
      return
    }

    try {
      const anchor = document.createElement('a')
      anchor.href = canvas.toDataURL('image/png')
      anchor.download = `promo-qrcode-${affCode || 'agent'}.png`
      anchor.click()
      toast.success(t(SUCCESS_MESSAGES.QRCODE_DOWNLOADED))
    } catch {
      toast.error(t(ERROR_MESSAGES.QRCODE_DOWNLOAD_FAILED))
    }
  }

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='space-y-3 p-4'>
        <div className='flex items-center gap-2.5'>
          <IconBadge tone='chart-1'>
            <QrCode />
          </IconBadge>
          <div className='min-w-0'>
            <h3 className='text-sm font-semibold'>{t('Sign-up QR Code')}</h3>
            <p className='text-muted-foreground text-xs'>
              {t('Scan to open your promo link.')}
            </p>
          </div>
        </div>

        {isLoadingOverview && !overview ? (
          <Skeleton className='mx-auto size-44 rounded-lg' />
        ) : (
          <div className='flex justify-center'>
            {promoLink ? (
              <div className='rounded-lg border bg-white p-2.5'>
                <QRCodeCanvas
                  ref={canvasRef}
                  value={promoLink}
                  size={QR_SIZE}
                  level='M'
                  marginSize={2}
                  role='img'
                  aria-label={t('QR code for your promo link')}
                />
              </div>
            ) : (
              <p className='text-muted-foreground py-8 text-xs'>
                {t('Your promo link is not available yet.')}
              </p>
            )}
          </div>
        )}

        <Button
          variant='outline'
          size='sm'
          className='w-full'
          disabled={!promoLink}
          onClick={handleDownload}
        >
          <Download className='size-4' aria-hidden='true' />
          {t('Download QR Code')}
        </Button>
      </CardContent>
    </Card>
  )
}
