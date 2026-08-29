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
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useDebounce } from '@/hooks/use-debounce'
import { handleServerError } from '@/lib/handle-server-error'

import { cancelSelfInvoiceRequest, getSelfInvoiceRequests } from '../api'
import {
  ERROR_MESSAGES,
  INVOICE_LIST_PAGE_SIZE,
  INVOICE_STATUS_FILTER_ALL,
  SUCCESS_MESSAGES,
} from '../constants'
import type { InvoiceRequest } from '../types'

export function useInvoiceRequests() {
  const [requests, setRequests] = useState<InvoiceRequest[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>(INVOICE_STATUS_FILTER_ALL)
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebounce(keyword)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const requestIdRef = useRef(0)

  const fetchRequests = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const response = await getSelfInvoiceRequests({
        p: page,
        page_size: INVOICE_LIST_PAGE_SIZE,
        status: status === INVOICE_STATUS_FILTER_ALL ? '' : status,
        keyword: debouncedKeyword,
      })

      if (requestId !== requestIdRef.current) return

      if (response.success && response.data) {
        setRequests(response.data.items ?? [])
        setTotal(response.data.total ?? 0)
        return
      }

      toast.error(
        response.message || i18next.t(ERROR_MESSAGES.REQUESTS_LOAD_FAILED)
      )
      setRequests([])
      setTotal(0)
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      handleServerError(error)
      setRequests([])
      setTotal(0)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [debouncedKeyword, page, status])

  useEffect(() => {
    if (keyword !== debouncedKeyword) return
    void fetchRequests()
  }, [debouncedKeyword, fetchRequests, keyword])

  const changeStatus = useCallback((next: string) => {
    setStatus(next)
    setPage(1)
  }, [])

  const changeKeyword = useCallback((next: string) => {
    requestIdRef.current += 1
    setKeyword(next)
    setPage(1)
  }, [])

  const cancelRequest = useCallback(
    async (id: number) => {
      setCancelling(true)
      try {
        const response = await cancelSelfInvoiceRequest(id)
        if (!response.success) {
          toast.error(
            response.message || i18next.t(ERROR_MESSAGES.REQUEST_CANCEL_FAILED)
          )
          return false
        }
        toast.success(i18next.t(SUCCESS_MESSAGES.REQUEST_CANCELLED))
        await fetchRequests()
        return true
      } catch (error) {
        handleServerError(error)
        return false
      } finally {
        setCancelling(false)
      }
    },
    [fetchRequests]
  )

  return {
    requests,
    total,
    page,
    pageSize: INVOICE_LIST_PAGE_SIZE,
    status,
    keyword,
    loading,
    cancelling,
    setPage,
    changeStatus,
    changeKeyword,
    cancelRequest,
    refresh: fetchRequests,
  }
}
