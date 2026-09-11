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
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { createAgentWithdrawal } from '../../api'
import {
  AGENT_WITHDRAWAL_METHOD_LABEL_KEYS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  WITHDRAWAL_DEFAULTS,
} from '../../constants'
import {
  computeWithdrawalBreakdown,
  formatAgentCurrency,
} from '../../lib/format'
import type { AgentWithdrawalMethod } from '../../types'
import { useAgent } from '../agent-provider'

const AMOUNT_INPUT_ID = 'agent-withdrawal-amount'
const AMOUNT_ERROR_ID = 'agent-withdrawal-amount-error'

function BreakdownRow(props: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className='flex items-center justify-between gap-2 text-sm'>
      <span className='text-muted-foreground'>{props.label}</span>
      <span
        className={
          props.emphasis
            ? 'text-success font-semibold tabular-nums'
            : 'font-medium tabular-nums'
        }
      >
        {props.value}
      </span>
    </div>
  )
}

/**
 * Withdrawal request.
 *
 * The client checks the two mistakes it can check — below the minimum, above the
 * available balance — and previews the fee. Everything else (one in-flight
 * request at a time, the live ledger balance under a row lock, bank details
 * present for a bank payout) is enforced server-side, and its message is shown
 * verbatim rather than reimplemented here.
 */
export function WithdrawalDialog() {
  const { t } = useTranslation()
  const {
    open,
    setOpen,
    withdrawalMethod,
    overview,
    refreshOverview,
    triggerRefresh,
  } = useAgent()
  const [amountDraft, setAmountDraft] = useState('')
  const [method, setMethod] = useState<AgentWithdrawalMethod | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isOpen = open === 'withdrawal'
  if (!isOpen) return null

  const available = overview?.stats.available ?? 0
  const minAmount = overview?.min_withdrawal ?? WITHDRAWAL_DEFAULTS.MIN_AMOUNT
  const feeRate = overview?.withdrawal_fee_rate ?? WITHDRAWAL_DEFAULTS.FEE_RATE
  // The shortcut carries the method in; the selector takes over once touched.
  const selectedMethod = method ?? withdrawalMethod

  const amount = Number(amountDraft)
  const hasAmount = amountDraft.trim().length > 0 && Number.isFinite(amount)
  const breakdown = computeWithdrawalBreakdown(hasAmount ? amount : 0, feeRate)

  const belowMinimum = hasAmount && amount < minAmount
  const aboveAvailable = hasAmount && amount > available
  const canSubmit = hasAmount && !belowMinimum && !aboveAvailable

  const errorMessage = (() => {
    if (belowMinimum) {
      return t(ERROR_MESSAGES.AMOUNT_BELOW_MINIMUM, {
        min: formatAgentCurrency(minAmount),
      })
    }
    if (aboveAvailable) return t(ERROR_MESSAGES.AMOUNT_ABOVE_AVAILABLE)
    return null
  })()

  const closeDialog = () => {
    setOpen(null)
    setAmountDraft('')
    setMethod(null)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return

    setIsSubmitting(true)
    try {
      const result = await createAgentWithdrawal({
        amount,
        method: selectedMethod,
      })
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.WITHDRAWAL_FAILED))
        return
      }
      toast.success(t(SUCCESS_MESSAGES.WITHDRAWAL_SUBMITTED))
      refreshOverview()
      triggerRefresh()
      closeDialog()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && closeDialog()}
      title={t('Withdraw Commission')}
      description={t('Choose where the money goes and how much to withdraw.')}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !canSubmit}
          >
            {isSubmitting ? t('Processing...') : t('Submit Request')}
          </Button>
        </>
      }
    >
      <div className='space-y-2'>
        <span className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
          {t('Available to Withdraw')}
        </span>
        <div className='text-2xl font-semibold tabular-nums'>
          {formatAgentCurrency(available)}
        </div>
      </div>

      <fieldset className='space-y-2'>
        <legend className='text-sm font-medium'>{t('Payout Method')}</legend>
        <RadioGroup
          value={selectedMethod}
          onValueChange={(value) => setMethod(value as AgentWithdrawalMethod)}
          className='gap-2'
        >
          {(['balance', 'bank'] as const).map((option) => (
            <div key={option} className='flex items-center gap-2'>
              <RadioGroupItem
                value={option}
                id={`agent-withdrawal-method-${option}`}
                disabled={isSubmitting}
              />
              <Label
                htmlFor={`agent-withdrawal-method-${option}`}
                className='cursor-pointer font-normal'
              >
                {t(AGENT_WITHDRAWAL_METHOD_LABEL_KEYS[option])}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <p className='text-muted-foreground text-xs'>
          {selectedMethod === 'balance'
            ? t('Transfers to your platform balance immediately, no review.')
            : t('Bank transfers are reviewed and paid out manually.')}
        </p>
      </fieldset>

      <div className='space-y-2'>
        <Label htmlFor={AMOUNT_INPUT_ID}>{t('Withdrawal Amount')}</Label>
        <Input
          id={AMOUNT_INPUT_ID}
          type='number'
          inputMode='decimal'
          value={amountDraft}
          onChange={(event) => setAmountDraft(event.target.value)}
          min={minAmount}
          max={available}
          step='0.01'
          disabled={isSubmitting}
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorMessage ? AMOUNT_ERROR_ID : undefined}
          className='font-mono text-lg'
        />
        {errorMessage ? (
          <p id={AMOUNT_ERROR_ID} className='text-destructive text-xs'>
            {errorMessage}
          </p>
        ) : (
          <p className='text-muted-foreground text-xs'>
            {t('Minimum:')} {formatAgentCurrency(minAmount)}
          </p>
        )}
      </div>

      <div className='bg-muted/40 space-y-1.5 rounded-lg border p-3'>
        <BreakdownRow
          label={t('Requested')}
          value={formatAgentCurrency(breakdown.amount)}
        />
        <BreakdownRow
          label={t('Processing Fee')}
          value={formatAgentCurrency(breakdown.fee)}
        />
        <BreakdownRow
          label={t('You Receive')}
          value={formatAgentCurrency(breakdown.net)}
          emphasis
        />
      </div>

      {selectedMethod === 'bank' && !overview?.profile.bank_account ? (
        <Alert variant='destructive'>
          <TriangleAlert aria-hidden='true' />
          <AlertDescription>
            {t(ERROR_MESSAGES.BANK_DETAILS_REQUIRED)}
          </AlertDescription>
        </Alert>
      ) : null}
    </Dialog>
  )
}
