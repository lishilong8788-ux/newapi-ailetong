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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { AGENT_PROFILE_VALIDATION, ERROR_MESSAGES } from '../constants'
import type {
  AgentProfile,
  AgentProfilePayload,
  AgentType,
  AgentWithdrawalMethod,
} from '../types'

// ============================================================================
// Profile Form
// ============================================================================

export type AgentProfileFormValues = {
  agent_type: AgentType
  subject_name: string
  id_no: string
  company_name: string
  tax_no: string
  bank_name: string
  bank_account: string
  bank_branch: string
  contact_name: string
  contact_phone: string
  contact_email: string
}

/**
 * Which identity fields are mandatory depends on the subject type: an
 * individual proves who they are with a name and an ID number, a business with
 * its registered name and taxpayer number. The irrelevant half is validated
 * only for length so switching type cannot trap the form behind an error on a
 * field the agent can no longer see.
 *
 * Bank details are intentionally not required here. They are needed for a bank
 * payout, which the withdrawal dialog checks at the moment it matters — asking
 * for them up front would block an agent who only ever transfers to balance.
 */
export function getAgentProfileFormSchema(t: TFunction) {
  const bounded = (max: number) =>
    z.string().trim().max(max, t(ERROR_MESSAGES.FIELD_TOO_LONG))

  return z
    .object({
      agent_type: z.enum(['personal', 'company']),
      subject_name: bounded(AGENT_PROFILE_VALIDATION.SUBJECT_NAME_MAX_LENGTH),
      id_no: bounded(AGENT_PROFILE_VALIDATION.ID_NO_MAX_LENGTH),
      company_name: bounded(AGENT_PROFILE_VALIDATION.COMPANY_NAME_MAX_LENGTH),
      tax_no: bounded(AGENT_PROFILE_VALIDATION.TAX_NO_MAX_LENGTH),
      bank_name: bounded(AGENT_PROFILE_VALIDATION.BANK_NAME_MAX_LENGTH),
      bank_account: bounded(AGENT_PROFILE_VALIDATION.BANK_ACCOUNT_MAX_LENGTH),
      bank_branch: bounded(AGENT_PROFILE_VALIDATION.BANK_BRANCH_MAX_LENGTH),
      contact_name: bounded(AGENT_PROFILE_VALIDATION.CONTACT_NAME_MAX_LENGTH),
      contact_phone: bounded(
        AGENT_PROFILE_VALIDATION.CONTACT_PHONE_MAX_LENGTH
      ).min(1, t(ERROR_MESSAGES.CONTACT_PHONE_REQUIRED)),
      contact_email: bounded(AGENT_PROFILE_VALIDATION.CONTACT_EMAIL_MAX_LENGTH),
    })
    .refine(
      (values) =>
        values.agent_type !== 'personal' || values.subject_name.length > 0,
      {
        path: ['subject_name'],
        message: t(ERROR_MESSAGES.SUBJECT_NAME_REQUIRED),
      }
    )
    .refine(
      (values) => values.agent_type !== 'personal' || values.id_no.length > 0,
      { path: ['id_no'], message: t(ERROR_MESSAGES.ID_NO_REQUIRED) }
    )
    .refine(
      (values) =>
        values.agent_type !== 'company' || values.company_name.length > 0,
      {
        path: ['company_name'],
        message: t(ERROR_MESSAGES.COMPANY_NAME_REQUIRED),
      }
    )
    .refine(
      (values) => values.agent_type !== 'company' || values.tax_no.length > 0,
      { path: ['tax_no'], message: t(ERROR_MESSAGES.TAX_NO_REQUIRED) }
    )
    .refine(
      (values) =>
        values.contact_email.length === 0 ||
        z.string().email().safeParse(values.contact_email).success,
      {
        path: ['contact_email'],
        message: t(ERROR_MESSAGES.CONTACT_EMAIL_INVALID),
      }
    )
}

export const AGENT_PROFILE_FORM_DEFAULTS: AgentProfileFormValues = {
  agent_type: 'personal',
  subject_name: '',
  id_no: '',
  company_name: '',
  tax_no: '',
  bank_name: '',
  bank_account: '',
  bank_branch: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
}

/**
 * Seeds the form from the saved profile.
 *
 * `bank_account` is deliberately left blank: the server sends it masked, so
 * echoing it back would submit the mask as the new account number.
 */
export function toAgentProfileFormValues(
  profile: AgentProfile | null | undefined
): AgentProfileFormValues {
  if (!profile) return AGENT_PROFILE_FORM_DEFAULTS

  return {
    agent_type: profile.agent_type ?? 'personal',
    subject_name: profile.subject_name ?? '',
    id_no: profile.id_no ?? '',
    company_name: profile.company_name ?? '',
    tax_no: profile.tax_no ?? '',
    bank_name: profile.bank_name ?? '',
    bank_account: '',
    bank_branch: profile.bank_branch ?? '',
    contact_name: profile.contact_name ?? '',
    contact_phone: profile.contact_phone ?? '',
    contact_email: profile.contact_email ?? '',
  }
}

// ============================================================================
// Withdrawal Form
// ============================================================================

export type WithdrawalFormValues = {
  amount: number
  method: AgentWithdrawalMethod
}

/**
 * Bounds the requested amount on the client so an obviously invalid request
 * never leaves the browser. The server re-validates against the live ledger
 * balance under a row lock, and its answer wins — this only spares the agent a
 * round trip for the two mistakes they are most likely to make.
 */
export function getWithdrawalFormSchema(
  t: TFunction,
  options: { minAmount: number; available: number; minLabel: string }
) {
  return z.object({
    amount: z
      .number()
      .refine((value) => Number.isFinite(value), {
        message: t(ERROR_MESSAGES.AMOUNT_BELOW_MINIMUM, {
          min: options.minLabel,
        }),
      })
      .refine((value) => value >= options.minAmount, {
        message: t(ERROR_MESSAGES.AMOUNT_BELOW_MINIMUM, {
          min: options.minLabel,
        }),
      })
      .refine((value) => value <= options.available, {
        message: t(ERROR_MESSAGES.AMOUNT_ABOVE_AVAILABLE),
      }),
    method: z.enum(['balance', 'bank']),
  })
}

/** Clears the fields the chosen subject type does not use. */
export function toAgentProfilePayload(
  values: AgentProfileFormValues
): AgentProfilePayload {
  const isCompany = values.agent_type === 'company'

  return {
    agent_type: values.agent_type,
    subject_name: isCompany ? '' : values.subject_name.trim(),
    id_no: isCompany ? '' : values.id_no.trim(),
    company_name: isCompany ? values.company_name.trim() : '',
    tax_no: isCompany ? values.tax_no.trim() : '',
    bank_name: values.bank_name.trim(),
    bank_account: values.bank_account.trim(),
    bank_branch: values.bank_branch.trim(),
    contact_name: values.contact_name.trim(),
    contact_phone: values.contact_phone.trim(),
    contact_email: values.contact_email.trim(),
  }
}
