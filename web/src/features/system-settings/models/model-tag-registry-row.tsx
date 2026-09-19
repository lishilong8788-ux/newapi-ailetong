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
import { ChevronDown, RotateCcw, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, dotColorMap, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TAG_COLOR_OPTIONS, TAG_KIND_OPTIONS, TAG_LIMITS } from '@/lib/model-tags'
import { cn } from '@/lib/utils'

import {
  TAG_LABEL_LANGUAGE_OPTIONS,
  isTagColor,
  type TagRegistryIssue,
  type TagRegistryRow,
  type TagRowPatch,
} from './model-tag-registry-core'
import {
  TAG_KIND_LABEL_KEYS,
  formatTagRegistryIssue,
} from './model-tag-registry-messages'

/**
 * Alias list text -> alias array. Comma is the separator because a tag can
 * never contain one (it is the separator of the stored `models.tags` column),
 * so splitting on it cannot corrupt a legitimate alias.
 */
function parseAliasDraft(draft: string): string[] {
  return draft
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean)
}

function ColorSwatch(props: { color: string }) {
  const className = isTagColor(props.color)
    ? dotColorMap[props.color as StatusVariant]
    : 'bg-muted'
  return (
    <span
      aria-hidden='true'
      className={cn('inline-block size-3 shrink-0 rounded-full', className)}
    />
  )
}

export type ModelTagRegistryRowProps = {
  row: TagRegistryRow
  issues: TagRegistryIssue[]
  /** Colour the catalog would paint, already resolved through the registry. */
  previewVariant: StatusVariant
  previewLabel: string
  onPatch: (id: string, patch: TagRowPatch) => void
  onReset: (id: string) => void
  onRemove: (id: string) => void
}

export function ModelTagRegistryRow(props: ModelTagRegistryRowProps) {
  const { t } = useTranslation()
  const rowKey = useId()
  const [expanded, setExpanded] = useState(false)
  const [aliasDraft, setAliasDraft] = useState(() => props.row.aliases.join(', '))

  // Keep the free-text alias buffer in step when the row changes from outside
  // (reset to built-in defaults, or a rewrite through the raw-JSON editor)
  // without fighting the operator's cursor on every keystroke.
  const aliasesFromProps = props.row.aliases.join(', ')
  const [lastSyncedAliases, setLastSyncedAliases] = useState(aliasesFromProps)
  if (aliasesFromProps !== lastSyncedAliases) {
    setLastSyncedAliases(aliasesFromProps)
    if (parseAliasDraft(aliasDraft).join(', ') !== aliasesFromProps) {
      setAliasDraft(aliasesFromProps)
    }
  }

  const slugIssues = props.issues.filter((issue) => issue.field === 'slug')
  const colorIssues = props.issues.filter((issue) => issue.field === 'color')
  const kindIssues = props.issues.filter((issue) => issue.field === 'kind')
  const pickerIssues = [...colorIssues, ...kindIssues]
  const aliasIssues = props.issues.filter((issue) => issue.field === 'aliases')
  const labelIssues = props.issues.filter((issue) => issue.field === 'label')
  // A problem hidden behind a collapsed row is a problem the operator cannot
  // find, so the detail panel opens itself when it holds one.
  const isOpen = expanded || labelIssues.length > 0 || aliasIssues.length > 0

  const detailId = `${rowKey}-detail`
  const slugErrorId = `${rowKey}-slug-error`
  const aliasesId = `${rowKey}-aliases`
  const aliasesErrorId = `${rowKey}-aliases-error`

  const statusLabel = () => {
    if (props.row.origin === 'custom') return t('Custom')
    return props.row.overridden ? t('Override') : t('Built-in default')
  }

  const emitLabel = (language: string, value: string) => {
    props.onPatch(props.row.id, {
      labels: { ...props.row.labels, [language]: value },
    })
  }

  return (
    <div
      data-tag-row={props.row.id}
      data-tag-overridden={props.row.overridden}
      className={cn(
        'rounded-lg border p-3',
        props.issues.length > 0 && 'border-destructive/60'
      )}
    >
      <div className='flex flex-wrap items-center gap-2'>
        <StatusBadge
          label={props.previewLabel || t('(no display name)')}
          variant={props.previewVariant}
          size='sm'
          copyable={false}
          filled
          className='shrink-0'
        />

        {props.row.origin === 'builtin' ? (
          <code className='bg-muted min-w-0 truncate rounded px-1.5 py-0.5 text-xs'>
            {props.row.slug}
          </code>
        ) : (
          <Input
            className='h-8 w-40'
            value={props.row.slug}
            placeholder={t('e.g. long-context')}
            maxLength={TAG_LIMITS.maxSlugLength * 2}
            aria-label={t('Tag identifier')}
            aria-invalid={slugIssues.length > 0}
            aria-describedby={slugIssues.length > 0 ? slugErrorId : undefined}
            onChange={(event) =>
              props.onPatch(props.row.id, { slug: event.target.value })
            }
          />
        )}

        <Select
          items={TAG_COLOR_OPTIONS.map((color) => ({
            value: color,
            label: color,
          }))}
          value={props.row.color}
          onValueChange={(value) => {
            if (typeof value === 'string' && value) {
              props.onPatch(props.row.id, { color: value })
            }
          }}
        >
          <SelectTrigger
            size='sm'
            className='w-36'
            aria-label={`${t('Color')}: ${props.row.slug || t('New tag')}`}
            aria-invalid={colorIssues.length > 0}
          >
            <SelectValue>
              <span className='flex min-w-0 items-center gap-1.5'>
                <ColorSwatch color={props.row.color} />
                <span className='truncate'>
                  {props.row.color || t('Select a color')}
                </span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {TAG_COLOR_OPTIONS.map((color) => (
                <SelectItem key={color} value={color}>
                  <span className='flex items-center gap-1.5'>
                    <ColorSwatch color={color} />
                    {color}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={TAG_KIND_OPTIONS.map((kind) => ({
            value: kind,
            label: t(TAG_KIND_LABEL_KEYS[kind] ?? kind),
          }))}
          value={props.row.kind}
          onValueChange={(value) => {
            if (typeof value === 'string' && value) {
              props.onPatch(props.row.id, { kind: value })
            }
          }}
        >
          <SelectTrigger
            size='sm'
            className='w-32'
            aria-label={`${t('Category')}: ${props.row.slug || t('New tag')}`}
            aria-invalid={kindIssues.length > 0}
          >
            <SelectValue placeholder={t('Category')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {TAG_KIND_OPTIONS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(TAG_KIND_LABEL_KEYS[kind] ?? kind)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <StatusBadge
          label={statusLabel()}
          variant={props.row.overridden ? 'info' : 'neutral'}
          size='sm'
          copyable={false}
          className='shrink-0'
        />

        <div className='ml-auto flex items-center gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            aria-expanded={isOpen}
            aria-controls={detailId}
            onClick={() => setExpanded((open) => !open)}
          >
            <ChevronDown
              aria-hidden='true'
              className={cn('size-4 transition-transform', isOpen && 'rotate-180')}
            />
            <span>{t('Names & aliases')}</span>
          </Button>
          {props.row.origin === 'builtin' ? (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              disabled={!props.row.overridden}
              aria-label={`${t('Restore built-in default')}: ${props.row.slug}`}
              onClick={() => props.onReset(props.row.id)}
            >
              <RotateCcw aria-hidden='true' className='size-4' />
            </Button>
          ) : (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={`${t('Delete')}: ${props.row.slug || t('New tag')}`}
              onClick={() => props.onRemove(props.row.id)}
            >
              <Trash2 aria-hidden='true' className='text-destructive size-4' />
            </Button>
          )}
        </div>
      </div>

      {slugIssues.length > 0 && (
        <p id={slugErrorId} role='alert' className='text-destructive mt-2 text-sm'>
          {slugIssues.map((issue) => formatTagRegistryIssue(t, issue)).join(' ')}
        </p>
      )}
      {pickerIssues.length > 0 && (
        <p role='alert' className='text-destructive mt-2 text-sm'>
          {pickerIssues
            .map((issue) => formatTagRegistryIssue(t, issue))
            .join(' ')}
        </p>
      )}

      <div id={detailId} hidden={!isOpen} className='mt-3 space-y-3'>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {TAG_LABEL_LANGUAGE_OPTIONS.map((language) => {
            const languageIssues = labelIssues.filter(
              (issue) => issue.language === language.code
            )
            const inputId = `${rowKey}-label-${language.code}`
            const errorId = `${inputId}-error`
            return (
              <div key={language.code} className='space-y-1'>
                <Label htmlFor={inputId} className='text-xs'>
                  {language.label}
                  {language.code === 'en' ? ` (${t('required')})` : ''}
                </Label>
                <Input
                  id={inputId}
                  className='h-8'
                  value={props.row.labels[language.code] ?? ''}
                  // An unset language renders through the English fallback, so
                  // show that word rather than leaving the field looking broken.
                  placeholder={
                    language.code === 'en'
                      ? undefined
                      : (props.row.labels.en ?? '')
                  }
                  maxLength={TAG_LIMITS.maxLabelLength}
                  aria-invalid={languageIssues.length > 0}
                  aria-describedby={
                    languageIssues.length > 0 ? errorId : undefined
                  }
                  onChange={(event) =>
                    emitLabel(language.code, event.target.value)
                  }
                />
                {languageIssues.length > 0 && (
                  <p id={errorId} role='alert' className='text-destructive text-xs'>
                    {languageIssues
                      .map((issue) => formatTagRegistryIssue(t, issue))
                      .join(' ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <div className='space-y-1'>
          <Label htmlFor={aliasesId} className='text-xs'>
            {t('Aliases (comma separated)')}
          </Label>
          <Input
            id={aliasesId}
            className='h-8'
            value={aliasDraft}
            placeholder={t('e.g. 热门, popular')}
            aria-invalid={aliasIssues.length > 0}
            aria-describedby={aliasIssues.length > 0 ? aliasesErrorId : undefined}
            onChange={(event) => {
              setAliasDraft(event.target.value)
              const aliases = parseAliasDraft(event.target.value)
              setLastSyncedAliases(aliases.join(', '))
              props.onPatch(props.row.id, { aliases })
            }}
          />
          {aliasIssues.length > 0 && (
            <p id={aliasesErrorId} role='alert' className='text-destructive text-xs'>
              {aliasIssues
                .map((issue) => formatTagRegistryIssue(t, issue))
                .join(' ')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
