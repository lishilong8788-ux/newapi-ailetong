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
import i18next from 'i18next'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import { createInvoiceRequest } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import type { InvoiceRequestFormValues } from '../lib'
import type { InvoiceableOrder } from '../types'

export function useInvoiceRequestSubmit() {
  const [submitting, setSubmitting] = useState(false)

  const submitRequest = useCallback(
    async (values: InvoiceRequestFormValues, orders: InvoiceableOrder[]) => {
      setSubmitting(true)
      try {
        const response = await createInvoiceRequest({
          profile_id: values.profile_id,
          invoice_type: values.invoice_type,
          recipient_email: values.recipient_email.trim(),
          remark: values.remark.trim(),
          orders: orders.map((order) => ({
            source_type: order.source_type,
            source_id: order.source_id,
          })),
        })

        if (!response.success) {
          toast.error(
            response.message || i18next.t(ERROR_MESSAGES.REQUEST_CREATE_FAILED)
          )
          return false
        }

        toast.success(i18next.t(SUCCESS_MESSAGES.REQUEST_CREATED))
        return true
      } catch (error) {
        handleServerError(error)
        return false
      } finally {
        setSubmitting(false)
      }
    },
    []
  )

  return { submitting, submitRequest }
}
