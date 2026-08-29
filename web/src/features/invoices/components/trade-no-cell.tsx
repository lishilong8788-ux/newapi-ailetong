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
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

interface TradeNoCellProps {
  tradeNo: string
  className?: string
}

/** Monospace order number with an inline copy button. */
export function TradeNoCell(props: TradeNoCellProps) {
  const { t } = useTranslation()
  const { copyToClipboard, copiedText } = useCopyToClipboard({ notify: false })
  const copied = copiedText === props.tradeNo

  return (
    <div className='flex min-w-0 items-center gap-1.5'>
      <code className='text-foreground truncate font-mono text-sm'>
        {props.tradeNo}
      </code>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='h-5 w-5 shrink-0 p-0'
        aria-label={t('Copy order number')}
        onClick={() => void copyToClipboard(props.tradeNo)}
      >
        {copied ? (
          <Check className='h-3 w-3' aria-hidden='true' />
        ) : (
          <Copy className='h-3 w-3' aria-hidden='true' />
        )}
      </Button>
    </div>
  )
}
