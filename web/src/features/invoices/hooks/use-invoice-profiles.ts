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
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import {
  createInvoiceProfile,
  deleteInvoiceProfile,
  getInvoiceProfiles,
  updateInvoiceProfile,
} from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  transformProfileFormToPayload,
  type InvoiceProfileFormValues,
} from '../lib'
import type { InvoiceProfile } from '../types'

export function useInvoiceProfiles() {
  const [profiles, setProfiles] = useState<InvoiceProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchProfiles = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getInvoiceProfiles()
      if (response.success) {
        setProfiles(response.data ?? [])
        return
      }
      toast.error(
        response.message || i18next.t(ERROR_MESSAGES.PROFILES_LOAD_FAILED)
      )
      setProfiles([])
    } catch (error) {
      handleServerError(error)
      setProfiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchProfiles()
  }, [fetchProfiles])

  const saveProfile = useCallback(
    async (values: InvoiceProfileFormValues, id?: number) => {
      setSaving(true)
      try {
        const payload = transformProfileFormToPayload(values)
        const response =
          id === undefined
            ? await createInvoiceProfile(payload)
            : await updateInvoiceProfile(id, payload)

        if (!response.success) {
          toast.error(
            response.message || i18next.t(ERROR_MESSAGES.PROFILE_SAVE_FAILED)
          )
          return false
        }

        toast.success(
          i18next.t(
            id === undefined
              ? SUCCESS_MESSAGES.PROFILE_CREATED
              : SUCCESS_MESSAGES.PROFILE_UPDATED
          )
        )
        await fetchProfiles()
        return true
      } catch (error) {
        handleServerError(error)
        return false
      } finally {
        setSaving(false)
      }
    },
    [fetchProfiles]
  )

  const removeProfile = useCallback(
    async (id: number) => {
      setSaving(true)
      try {
        const response = await deleteInvoiceProfile(id)
        if (!response.success) {
          toast.error(
            response.message || i18next.t(ERROR_MESSAGES.PROFILE_DELETE_FAILED)
          )
          return false
        }
        toast.success(i18next.t(SUCCESS_MESSAGES.PROFILE_DELETED))
        await fetchProfiles()
        return true
      } catch (error) {
        handleServerError(error)
        return false
      } finally {
        setSaving(false)
      }
    },
    [fetchProfiles]
  )

  const markProfileDefault = useCallback(
    async (profile: InvoiceProfile) => {
      setSaving(true)
      try {
        const response = await updateInvoiceProfile(profile.id, {
          title_type: profile.title_type,
          title: profile.title,
          tax_no: profile.tax_no,
          address: profile.address,
          phone: profile.phone,
          bank_name: profile.bank_name,
          bank_account: profile.bank_account,
          is_default: true,
        })
        if (!response.success) {
          toast.error(
            response.message || i18next.t(ERROR_MESSAGES.PROFILE_SAVE_FAILED)
          )
          return false
        }
        toast.success(i18next.t(SUCCESS_MESSAGES.PROFILE_SET_DEFAULT))
        await fetchProfiles()
        return true
      } catch (error) {
        handleServerError(error)
        return false
      } finally {
        setSaving(false)
      }
    },
    [fetchProfiles]
  )

  return {
    profiles,
    loading,
    saving,
    refresh: fetchProfiles,
    saveProfile,
    removeProfile,
    markProfileDefault,
  }
}
