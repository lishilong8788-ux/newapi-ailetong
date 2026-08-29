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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import { getInvoiceableOrders } from '../api'
import { ERROR_MESSAGES } from '../constants'
import { resolveSelectionCurrency, sumMinorUnits } from '../lib'
import type { InvoiceableOrder } from '../types'

/** Stable identity for an order across the two source tables. */
export function getOrderKey(order: InvoiceableOrder): string {
  return `${order.source_type}:${order.source_id}`
}

export function useInvoiceableOrders() {
  const [orders, setOrders] = useState<InvoiceableOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getInvoiceableOrders()
      if (response.success) {
        setOrders(response.data ?? [])
        setSelectedKeys([])
        return
      }
      toast.error(
        response.message || i18next.t(ERROR_MESSAGES.ORDERS_LOAD_FAILED)
      )
      setOrders([])
    } catch (error) {
      handleServerError(error)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchOrders()
  }, [fetchOrders])

  const toggleOrder = useCallback((order: InvoiceableOrder) => {
    const key = getOrderKey(order)
    setSelectedKeys((previous) =>
      previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key]
    )
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedKeys((previous) =>
      previous.length === orders.length ? [] : orders.map(getOrderKey)
    )
  }, [orders])

  const clearSelection = useCallback(() => setSelectedKeys([]), [])

  const selectedOrders = useMemo(
    () => orders.filter((order) => selectedKeys.includes(getOrderKey(order))),
    [orders, selectedKeys]
  )

  const selectionCurrency = useMemo(
    () => resolveSelectionCurrency(selectedOrders),
    [selectedOrders]
  )

  const selectedTotalMinor = useMemo(
    () => sumMinorUnits(selectedOrders.map((order) => order.amount)),
    [selectedOrders]
  )

  return {
    orders,
    loading,
    selectedKeys,
    selectedOrders,
    selectionCurrency,
    selectedTotalMinor,
    refresh: fetchOrders,
    toggleOrder,
    toggleAll,
    clearSelection,
  }
}
