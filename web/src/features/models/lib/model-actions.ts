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
import type { QueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import {
  updateModelStatus,
  deleteModel as deleteModelAPI,
  batchUpdateModelTags,
} from '../api'
import { modelsQueryKeys } from './query-keys'

// ============================================================================
// Model Status Actions
// ============================================================================

/**
 * Enable a model
 */
export async function handleEnableModel(
  id: number,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  try {
    const response = await updateModelStatus(id, 1)
    if (response.success) {
      toast.success(i18next.t('Model enabled successfully'))
      queryClient?.invalidateQueries({ queryKey: modelsQueryKeys.lists() })
      onSuccess?.()
    } else {
      toast.error(response.message || i18next.t('Failed to enable model'))
    }
  } catch (error: unknown) {
    toast.error(
      (error as Error)?.message || i18next.t('Failed to enable model')
    )
  }
}

/**
 * Disable a model
 */
export async function handleDisableModel(
  id: number,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  try {
    const response = await updateModelStatus(id, 0)
    if (response.success) {
      toast.success(i18next.t('Model disabled successfully'))
      queryClient?.invalidateQueries({ queryKey: modelsQueryKeys.lists() })
      onSuccess?.()
    } else {
      toast.error(response.message || i18next.t('Failed to disable model'))
    }
  } catch (error: unknown) {
    toast.error(
      (error as Error)?.message || i18next.t('Failed to disable model')
    )
  }
}

/**
 * Toggle model status
 */
export async function handleToggleModelStatus(
  id: number,
  currentStatus: number,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (currentStatus === 1) {
    await handleDisableModel(id, queryClient, onSuccess)
  } else {
    await handleEnableModel(id, queryClient, onSuccess)
  }
}

// ============================================================================
// Model Delete Actions
// ============================================================================

/**
 * Delete a single model
 */
export async function handleDeleteModel(
  id: number,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  try {
    const response = await deleteModelAPI(id)
    if (response.success) {
      toast.success(i18next.t('Model deleted successfully'))
      queryClient?.invalidateQueries({ queryKey: modelsQueryKeys.lists() })
      onSuccess?.()
    } else {
      toast.error(response.message || i18next.t('Failed to delete model'))
    }
  } catch (error: unknown) {
    toast.error(
      (error as Error)?.message || i18next.t('Failed to delete model')
    )
  }
}

/**
 * Batch delete models
 */
export async function handleBatchDeleteModels(
  ids: number[],
  queryClient?: QueryClient,
  onSuccess?: (deletedCount: number) => void
): Promise<void> {
  if (ids.length === 0) {
    toast.error(i18next.t('Please select at least one model'))
    return
  }

  try {
    const deletePromises = ids.map((id) => deleteModelAPI(id))
    const results = await Promise.all(deletePromises)

    let successCount = 0
    let failedCount = 0

    results.forEach((res, index) => {
      if (res.success) {
        successCount++
      } else {
        failedCount++
        // eslint-disable-next-line no-console
        console.error(`Failed to delete model ${ids[index]}:`, res.message)
      }
    })

    if (successCount > 0) {
      toast.success(
        i18next.t('Successfully deleted {{count}} model(s)', {
          count: successCount,
        })
      )
      queryClient?.invalidateQueries({ queryKey: modelsQueryKeys.lists() })
      onSuccess?.(successCount)
    }

    if (failedCount > 0) {
      toast.error(
        i18next.t('Failed to delete {{count}} model(s)', { count: failedCount })
      )
    }
  } catch (error: unknown) {
    toast.error((error as Error)?.message || i18next.t('Batch delete failed'))
  }
}

// ============================================================================
// Batch Status Actions
// ============================================================================

/**
 * Batch enable models
 */
export async function handleBatchEnableModels(
  ids: number[],
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (ids.length === 0) {
    toast.error(i18next.t('Please select at least one model'))
    return
  }

  try {
    const enablePromises = ids.map((id) => updateModelStatus(id, 1))
    const results = await Promise.all(enablePromises)

    let successCount = 0
    let failedCount = 0

    results.forEach((res) => {
      if (res.success) {
        successCount++
      } else {
        failedCount++
      }
    })

    if (successCount > 0) {
      toast.success(
        i18next.t('Successfully enabled {{count}} model(s)', {
          count: successCount,
        })
      )
      queryClient?.invalidateQueries({ queryKey: modelsQueryKeys.lists() })
      onSuccess?.()
    }

    if (failedCount > 0) {
      toast.error(
        i18next.t('Failed to enable {{count}} model(s)', { count: failedCount })
      )
    }
  } catch (error: unknown) {
    toast.error((error as Error)?.message || i18next.t('Batch enable failed'))
  }
}

/**
 * Batch disable models
 */
export async function handleBatchDisableModels(
  ids: number[],
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (ids.length === 0) {
    toast.error(i18next.t('Please select at least one model'))
    return
  }

  try {
    const disablePromises = ids.map((id) => updateModelStatus(id, 0))
    const results = await Promise.all(disablePromises)

    let successCount = 0
    let failedCount = 0

    results.forEach((res) => {
      if (res.success) {
        successCount++
      } else {
        failedCount++
      }
    })

    if (successCount > 0) {
      toast.success(
        i18next.t('Successfully disabled {{count}} model(s)', {
          count: successCount,
        })
      )
      queryClient?.invalidateQueries({ queryKey: modelsQueryKeys.lists() })
      onSuccess?.()
    }

    if (failedCount > 0) {
      toast.error(
        i18next.t('Failed to disable {{count}} model(s)', {
          count: failedCount,
        })
      )
    }
  } catch (error: unknown) {
    toast.error((error as Error)?.message || i18next.t('Batch disable failed'))
  }
}

// ============================================================================
// Batch Tag Actions
// ============================================================================

/** Mirrors `maxBatchTagModelIds` in `controller/model_meta.go`, so an oversized
 *  selection is refused here with a translated message instead of coming back
 *  from the server as a raw Chinese string. */
export const MAX_BATCH_TAG_MODELS = 200

/**
 * Add and/or remove tags on the selected models.
 *
 * Deliberately one request, unlike the status actions above: see
 * `batchUpdateModelTags`. That also means there is a single result to report,
 * so no partial-success bookkeeping is needed on this side.
 */
export async function handleBatchUpdateModelTags(
  ids: number[],
  addTags: string[],
  removeTags: string[],
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (ids.length === 0) {
    toast.error(i18next.t('Please select at least one model'))
    return
  }
  if (addTags.length === 0 && removeTags.length === 0) {
    toast.error(i18next.t('Add or remove at least one tag'))
    return
  }
  if (ids.length > MAX_BATCH_TAG_MODELS) {
    toast.error(
      i18next.t('At most {{max}} models can be tagged at once', {
        max: MAX_BATCH_TAG_MODELS,
      })
    )
    return
  }

  try {
    const response = await batchUpdateModelTags({
      ids,
      add_tags: addTags,
      remove_tags: removeTags,
    })

    if (!response.success) {
      toast.error(response.message || i18next.t('Failed to update tags'))
      return
    }

    // A run where nothing changed is a normal outcome — every selected model
    // already had the tags — so it is reported, not treated as a failure.
    const updated = response.data?.updated ?? 0
    if (updated > 0) {
      toast.success(
        i18next.t('Updated tags on {{count}} model(s)', { count: updated })
      )
    } else {
      toast.info(i18next.t('No models needed a tag change'))
    }

    // The server reports failures as a list of rows, not a count, so a partial
    // failure can name the models that did not take the edit — an operator who
    // sees only a number has no way to find them in a 200-row selection.
    const failures = response.data?.failures ?? []
    if (failures.length > 0) {
      const names = failures
        .map((failure) => failure.model_name || String(failure.id))
        .join(', ')
      toast.error(
        i18next.t('Failed to update tags on {{count}} model(s): {{names}}', {
          count: failures.length,
          names,
        })
      )
    }

    // Tags change row content, so detail queries an open drawer may hold are
    // stale too, not just the list.
    queryClient?.invalidateQueries({ queryKey: modelsQueryKeys.all })
    onSuccess?.()
  } catch (error: unknown) {
    toast.error((error as Error)?.message || i18next.t('Failed to update tags'))
  }
}
