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
import { useQueryClient } from '@tanstack/react-query'
import { Code2, Eye, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { JsonCodeEditor } from '@/components/json-code-editor'
import type { StatusVariant } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { TAG_LIMITS, resolveTag, type TagDefinition } from '@/lib/model-tags'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  TAG_REGISTRY_OPTION_KEY,
  addCustomTagRow,
  applyTagRowEdit,
  buildTagRegistryRows,
  groupTagRegistryIssues,
  removeTagRow,
  resetTagRow,
  selectPersistedTagRows,
  serializeTagRegistryRows,
  toTagDefinition,
  validateTagRegistryRows,
  type TagLabelTranslator,
  type TagRegistryRow,
  type TagRowPatch,
} from './model-tag-registry-core'
import { formatTagRegistryIssue } from './model-tag-registry-messages'
import { ModelTagRegistryRow } from './model-tag-registry-row'
import { formatJsonForTextarea } from './utils'

export type ModelTagRegistrySettingsProps = {
  /** Raw `pricing_setting.tag_registry`. Empty means "no overrides". */
  defaultValue: string
}

export function ModelTagRegistrySettings(props: ModelTagRegistrySettingsProps) {
  const { t, i18n } = useTranslation()
  const updateOption = useUpdateOption()
  const queryClient = useQueryClient()

  // Built-in labels are seeded in every interface language at once, so an
  // override keeps its translations instead of collapsing to the slug.
  const translateBuiltinLabel = useMemo<TagLabelTranslator>(
    () => (language, key) => i18n.getFixedT(language)(key),
    [i18n]
  )

  const [rows, setRows] = useState<TagRegistryRow[]>([])
  const [editMode, setEditMode] = useState<'visual' | 'json'>('visual')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [savedValue, setSavedValue] = useState(props.defaultValue ?? '')
  const nextCustomId = useRef(0)

  const loadFromValue = useCallback(
    (value: string) => {
      const result = buildTagRegistryRows(value, translateBuiltinLabel)
      setRows(result.rows)
      setJsonText(formatJsonForTextarea(serializeTagRegistryRows(result.rows)))
      setJsonError(
        result.parseFailed
          ? t('The saved tag registry could not be read as a JSON array.')
          : ''
      )
      if (result.parseFailed) setEditMode('json')
      return result
    },
    [t, translateBuiltinLabel]
  )

  const loadedValueRef = useRef<string | null>(null)
  useEffect(() => {
    const incoming = props.defaultValue ?? ''
    if (loadedValueRef.current === incoming) return
    loadedValueRef.current = incoming
    setSavedValue(incoming)
    loadFromValue(incoming)
  }, [props.defaultValue, loadFromValue])

  const serialized = useMemo(() => serializeTagRegistryRows(rows), [rows])
  const issues = useMemo(() => validateTagRegistryRows(rows), [rows])
  const issuesByRow = useMemo(() => groupTagRegistryIssues(issues), [issues])
  const registryIssues = issues.filter((issue) => !issue.rowId)
  const overriddenCount = selectPersistedTagRows(rows).length

  // The saved baseline is re-serialized through the same writer, so a stored
  // value that merely differs in key order or whitespace does not read as dirty.
  const savedSerialized = useMemo(
    () =>
      serializeTagRegistryRows(
        buildTagRegistryRows(savedValue, translateBuiltinLabel).rows
      ),
    [savedValue, translateBuiltinLabel]
  )
  const isDirty = serialized !== savedSerialized

  /**
   * Registry the preview resolves against: every row, including untouched
   * built-ins, so the badge shows exactly what the catalog would paint. Stable
   * identity keeps the lookup map in `model-tags` from being rebuilt per row.
   */
  const previewRegistry = useMemo<TagDefinition[]>(
    () =>
      rows
        .filter((row) => row.slug.trim())
        .map((row) => toTagDefinition(row)),
    [rows]
  )

  const resolvePreview = (row: TagRegistryRow) => {
    if (!row.slug.trim()) {
      return { variant: 'neutral' as StatusVariant, label: '' }
    }
    const resolved = resolveTag(row.slug, {
      registry: previewRegistry,
      t,
      language: i18n.language,
    })
    return { variant: resolved.variant, label: resolved.label }
  }

  const syncJsonFromRows = (nextRows: TagRegistryRow[]) => {
    setRows(nextRows)
    setJsonText(formatJsonForTextarea(serializeTagRegistryRows(nextRows)))
    setJsonError('')
  }

  const handlePatch = (id: string, patch: TagRowPatch) => {
    syncJsonFromRows(applyTagRowEdit(rows, id, patch))
  }

  const handleReset = (id: string) => {
    syncJsonFromRows(resetTagRow(rows, id))
  }

  const handleRemove = (id: string) => {
    syncJsonFromRows(removeTagRow(rows, id))
  }

  const handleAdd = () => {
    syncJsonFromRows(addCustomTagRow(rows, `new:${nextCustomId.current++}`))
  }

  const handleJsonChange = (text: string) => {
    setJsonText(text)
    const trimmed = text.trim()
    if (!trimmed) {
      setRows(buildTagRegistryRows('', translateBuiltinLabel).rows)
      setJsonError('')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : t('Invalid JSON'))
      return
    }
    if (!Array.isArray(parsed)) {
      setJsonError(t('Tag registry must be a JSON array'))
      return
    }
    setRows(buildTagRegistryRows(trimmed, translateBuiltinLabel).rows)
    setJsonError('')
  }

  const handleRevert = () => {
    loadFromValue(savedValue)
  }

  const handleSave = async () => {
    if (issues.length > 0) {
      toast.error(t('Fix the highlighted tags before saving'))
      return
    }
    if (jsonError) {
      toast.error(t('Please fix JSON errors before saving'))
      return
    }
    if (!isDirty) {
      toast.info(t('No changes to save'))
      return
    }

    try {
      await updateOption.mutateAsync({
        key: TAG_REGISTRY_OPTION_KEY,
        value: serialized,
      })
    } catch {
      // The mutation reports the server's reason itself. The baseline stays put
      // so the rows remain dirty and the operator can correct and retry.
      return
    }

    setSavedValue(serialized)
    loadedValueRef.current = serialized
    // The catalog reads the registry off /api/status, not off the options list,
    // so that cache has to be dropped for the new colours to show up.
    queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    try {
      window.localStorage.removeItem('status')
    } catch {
      /* empty */
    }
  }

  const atEntryCap = overriddenCount >= TAG_LIMITS.maxRegistryEntries

  return (
    <>
      <FormNavigationGuard when={isDirty} />

      <SettingsSection title={t('Model Tags')}>
        <SettingsPageFormActions
          onSave={handleSave}
          onReset={handleRevert}
          isSaving={updateOption.isPending}
          isSaveDisabled={issues.length > 0 || Boolean(jsonError)}
          isResetDisabled={!isDirty}
        />
        <FormDirtyIndicator isDirty={isDirty} />

        <Alert>
          <AlertDescription className='space-y-1 text-sm'>
            <div>
              {t(
                'Controls the color, category and display name of the tags shown on the model catalog. Only the tags you change are saved, the rest keep their built-in defaults.'
              )}
            </div>
            <div>
              {t(
                'Aliases are extra spellings that resolve to the same tag, so a model tagged 热门 and one tagged hot get the same badge without editing either model.'
              )}
            </div>
          </AlertDescription>
        </Alert>

        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleAdd}
              disabled={atEntryCap}
            >
              <Plus aria-hidden='true' data-icon='inline-start' />
              <span>{t('Add tag')}</span>
            </Button>
            <span className='text-muted-foreground text-xs'>
              {t('{{count}} of {{max}} custom tags saved', {
                count: overriddenCount,
                max: TAG_LIMITS.maxRegistryEntries,
              })}
            </span>
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() =>
              setEditMode((mode) => (mode === 'visual' ? 'json' : 'visual'))
            }
          >
            {editMode === 'visual' ? (
              <>
                <Code2 aria-hidden='true' data-icon='inline-start' />
                <span>{t('Switch to JSON')}</span>
              </>
            ) : (
              <>
                <Eye aria-hidden='true' data-icon='inline-start' />
                <span>{t('Switch to Visual')}</span>
              </>
            )}
          </Button>
        </div>

        {registryIssues.length > 0 && (
          <Alert variant='destructive'>
            <AlertDescription>
              {registryIssues
                .map((issue) => formatTagRegistryIssue(t, issue))
                .join(' ')}
            </AlertDescription>
          </Alert>
        )}

        {editMode === 'visual' ? (
          <div className='space-y-2'>
            {rows.map((row) => {
              const preview = resolvePreview(row)
              return (
                <ModelTagRegistryRow
                  key={row.id}
                  row={row}
                  issues={issuesByRow.get(row.id) ?? []}
                  previewVariant={preview.variant}
                  previewLabel={preview.label}
                  onPatch={handlePatch}
                  onReset={handleReset}
                  onRemove={handleRemove}
                />
              )
            })}
          </div>
        ) : (
          <div className='space-y-2'>
            <JsonCodeEditor
              value={jsonText}
              onChange={handleJsonChange}
              heightClassName='h-96 min-h-96 max-h-96'
              ariaLabel={t('Tag registry JSON')}
              aria-invalid={Boolean(jsonError)}
            />
            {jsonError && (
              <p role='alert' className='text-destructive text-sm'>
                {jsonError}
              </p>
            )}
            <p className='text-muted-foreground text-xs'>
              {t(
                'Only overrides are stored here. Removing an entry restores that tag to its built-in default.'
              )}
            </p>
          </div>
        )}
      </SettingsSection>
    </>
  )
}
