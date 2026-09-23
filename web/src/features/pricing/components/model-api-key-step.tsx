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
import { Link } from '@tanstack/react-router'
import { ArrowRight, Check, Copy, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import { API_KEY_STATUS } from '@/features/keys/constants'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatQuota } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { StepCard } from './model-api-steps'

/**
 * The mask shown in place of the key.
 *
 * Fixed-width rather than derived from the real key's length: the real key never
 * reaches this component, which is the point (see ApiKeyStep).
 */
const KEY_MASK = 'sk-••••••••••••••••••••••••'

/**
 * Step 3: the key to sign requests with.
 *
 * The key is rendered as a mask and the plaintext never enters the DOM. Only the
 * copy button fetches it — `POST /api/token/:id/key`, straight into the
 * clipboard — because the pricing page is reachable while screen-sharing or
 * projecting, and a key left on screen outlives the moment it was useful. This
 * is the same trade the dashboard's "first request" card makes.
 */
export function ApiKeyStep(props: { index: number }) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [isCopying, setIsCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const { copyToClipboard } = useCopyToClipboard({ notify: false })

  // Anonymous visitors get the create-a-key call to action instead of a request
  // that would 401. The pricing page is public, so this is a normal state.
  const { data: key, isLoading } = useQuery({
    queryKey: ['pricing-api-key-step', userId],
    queryFn: async () => {
      const result = await getApiKeys({ p: 1, size: 50 })
      if (!result.success) return null
      const items = result.data?.items ?? []
      return items.find((item) => item.status === API_KEY_STATUS.ENABLED) ?? null
    },
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  })

  const handleCopy = async () => {
    if (!key || isCopying) return
    setIsCopying(true)
    try {
      const result = await fetchTokenKey(key.id)
      const raw = result.success && result.data?.key ? result.data.key : ''
      if (!raw) {
        toast.error(result.message || t('Failed to copy to clipboard'))
        return
      }
      const ok = await copyToClipboard(`sk-${raw}`)
      if (ok) {
        setCopied(true)
        toast.success(t('Copied to clipboard'))
        setTimeout(() => setCopied(false), 2000)
      } else {
        toast.error(t('Failed to copy to clipboard'))
      }
    } finally {
      setIsCopying(false)
    }
  }

  // The header line is the one value here that is typed rather than copied, so
  // it gets a terminal-flavoured surface instead of a bare row: it reads as
  // "this is literally what goes on the wire".
  const authNote = (
    <div className='bg-foreground/[0.055] ring-border rounded-xl px-3 py-2.5 ring-1 dark:bg-black/25'>
      <span className='text-muted-foreground inline-flex items-center gap-1 text-xs font-medium'>
        <KeyRound className='size-3' aria-hidden />
        {t('Authentication')}
      </span>
      <code className='text-foreground mt-1 block font-mono text-[13px] font-semibold break-all'>
        <span className='text-info'>Authorization:</span> Bearer{' '}
        <span className='text-muted-foreground'>&lt;YOUR_API_KEY&gt;</span>
      </code>
      <p className='text-muted-foreground mt-1 text-[11px] leading-relaxed'>
        {t('The anthropic endpoint also accepts the x-api-key header.')}
      </p>
    </div>
  )

  let body: React.ReactNode
  if (isLoading) {
    body = (
      <div className='bg-primary/[0.045] ring-primary/12 space-y-2 rounded-xl px-3 py-2.5 ring-1'>
        <Skeleton className='h-3 w-24' />
        <Skeleton className='h-5 w-full max-w-xs' />
      </div>
    )
  } else if (key) {
    body = (
      <div className='bg-primary/[0.045] ring-primary/12 rounded-xl px-3 py-2.5 ring-1'>
          <div className='flex items-center justify-between gap-2'>
            <span className='flex min-w-0 items-center gap-1.5'>
              <span
                className='bg-primary ring-primary/20 size-1.5 shrink-0 rounded-full ring-2'
                aria-hidden
              />
              <span className='text-muted-foreground min-w-0 truncate text-xs font-medium'>
                {key.name || t('API key')}
              </span>
              <Badge
                variant='outline'
                className='h-5 shrink-0 border-emerald-500/40 px-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400'
              >
                {t('Enabled')}
              </Badge>
            </span>
            <span className='text-muted-foreground shrink-0 font-mono text-[10px] font-medium tabular-nums'>
              {key.unlimited_quota
                ? t('Unlimited')
                : formatQuota(key.remain_quota)}
            </span>
          </div>
          <div className='mt-1.5 flex items-center gap-2'>
            {/* The mask, not the key. `handleCopy` is the only path to the real
                value and it goes straight to the clipboard. */}
            <code className='text-foreground min-w-0 flex-1 font-mono text-[13px] leading-relaxed font-semibold break-all'>
              {KEY_MASK}
            </code>
            <Button
              variant='ghost'
              size='sm'
              className='bg-primary/10 text-primary hover:bg-primary/18 hover:text-primary h-7 shrink-0 gap-1 px-2.5 text-[11px] font-semibold'
              disabled={isCopying}
              onClick={handleCopy}
              aria-label={copied ? t('Copied') : t('Copy API key')}
            >
              {copied ? (
                <Check className='text-success size-3' />
              ) : (
                <Copy className='size-3' />
              )}
              {t('Copy')}
            </Button>
          </div>
        <p className='text-muted-foreground mt-1.5 text-[11px] leading-relaxed'>
          {t(
            'The key is hidden here; copying puts the real value on your clipboard.'
          )}
        </p>
      </div>
    )
  } else {
    body = (
      <div className='bg-primary/[0.045] ring-primary/12 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5 ring-1'>
        <p className='text-muted-foreground min-w-0 text-xs'>
          {userId
            ? t('You have no enabled API key yet.')
            : t('Sign in and create an API key to call this model.')}
        </p>
        <Button size='sm' variant='outline' render={<Link to='/keys' />}>
          {t('Create API key')}
        </Button>
      </div>
    )
  }

  return (
    <StepCard
      index={props.index}
      icon={KeyRound}
      title={t('Copy your API key')}
      hint={t('Send it in the Authorization header of every request.')}
      trailing={
        <Link
          to='/keys'
          className='text-primary hover:text-primary/80 inline-flex shrink-0 items-center gap-1 text-xs font-semibold transition-colors'
        >
          {t('Manage keys')}
          <ArrowRight className='size-3' />
        </Link>
      }
    >
      {body}
      {authNote}
    </StepCard>
  )
}
