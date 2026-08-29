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
import { useCallback, useEffect, useState } from 'react'

import { getInvoiceAmountSummary } from '../api'
import type { InvoiceAmountSummary } from '../types'

/**
 * Loads the pending / issued / invoiceable totals shown above the list.
 *
 * A failure here is deliberately silent: the summary is a read-only header and
 * an error toast on top of the list's own error would just be noise. The stats
 * fall back to an empty state, which renders as zero.
 */
export function useInvoiceSummary() {
  const [summaries, setSummaries] = useState<InvoiceAmountSummary[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getInvoiceAmountSummary()
      setSummaries(response.success ? (response.data ?? []) : [])
    } catch {
      setSummaries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  return { summaries, loading, refresh: fetchSummary }
}
