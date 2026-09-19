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
import { X } from 'lucide-react'
import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Rules a caller wants applied to one candidate tag.
 *
 * Returns a ready-to-show message, or `null` to accept. The component holds no
 * opinion of its own: it is used both for model tags, which have a slug
 * vocabulary and forbid the separators the storage format uses, and for prefill
 * group items, which are arbitrary endpoint or model names. Baking either
 * ruleset in would break the other.
 */
export type TagInputValidator = (
  candidate: string,
  current: readonly string[]
) => string | null

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Opt-in validation. Absent means every non-duplicate value is accepted. */
  validate?: TagInputValidator
  /** Offered under the field as a native datalist. Purely advisory. */
  suggestions?: string[]
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/**
 * Split text into candidate tags.
 *
 * Only splits when the caller validates, and only on `,` and newlines. Those
 * are the separators a paste actually arrives with — the stored `models.tags`
 * string is comma-joined, and a column copied out of a spreadsheet is newline
 * separated — so splitting them is what the operator meant. `;` and `|` are
 * deliberately not split: a validator that forbids them should say so, rather
 * than have the component quietly guess at a second storage format.
 *
 * Without a validator the text is one candidate, whatever it contains, which is
 * the pre-existing contract prefill groups rely on.
 */
function splitCandidateTags(text: string, hasValidator: boolean): string[] {
  if (!hasValidator) return [text]
  return text.split(/[\n\r,]/)
}

export function TagInput(props: TagInputProps) {
  const { t } = useTranslation()
  const value = props.value ?? []
  const disabled = props.disabled ?? false
  const placeholderText = props.placeholder ?? t('Add tags...')
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reactId = useId()
  const errorId = `${reactId}-tag-input-error`
  const suggestionsId = `${reactId}-tag-input-suggestions`

  const availableSuggestions = (props.suggestions ?? []).filter(
    (suggestion) => !value.includes(suggestion)
  )

  const describedBy =
    [props['aria-describedby'], error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined

  /**
   * Add every candidate that passes, stopping at the first that does not.
   *
   * The refused candidate and everything after it stay in the input rather than
   * being dropped, so a rejected paste is something the operator can fix in
   * place. Accepted tags accumulate locally because `onChange` is only applied
   * once: reading `value` back mid-loop would still see the pre-update array.
   */
  const addCandidates = (candidates: string[]) => {
    const next = [...value]
    let added = false

    for (const [index, candidate] of candidates.entries()) {
      const trimmed = candidate.trim()

      if (!props.validate) {
        // Legacy path: skip blanks and exact duplicates silently, accept the
        // rest verbatim. Unchanged from before validation existed.
        if (trimmed && !next.includes(trimmed)) {
          next.push(trimmed)
          added = true
        }
        continue
      }

      // An empty candidate is a stray separator, not something to complain
      // about: pasting `hot,` or pressing Enter on an empty field is not an
      // error the operator needs told about.
      if (!trimmed) continue

      const message = props.validate(trimmed, next)
      if (message) {
        if (added) props.onChange(next)
        setError(message)
        setInputValue(candidates.slice(index).join(','))
        return
      }

      next.push(trimmed)
      added = true
    }

    if (added) {
      props.onChange(next)
      setInputValue('')
    }
    setError(null)
  }

  const removeTag = (tagToRemove: string) => {
    props.onChange(value.filter((tag) => tag !== tagToRemove))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addCandidates([inputValue])
      return
    }

    const last = value.at(-1)
    if (e.key === 'Backspace' && !inputValue && last !== undefined) {
      removeTag(last)
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (!props.validate) return

    const pasted = e.clipboardData.getData('text')
    if (!/[\n\r,]/.test(pasted)) return

    // Multi-tag paste: intercept it, because neither the Enter nor the `,`
    // key handler ever sees a paste, so `a,b,c` used to land in the field as
    // one value and be stored as one comma-bearing tag.
    e.preventDefault()
    addCandidates(splitCandidateTags(inputValue + pasted, true))
  }

  const handleBlur = () => {
    // Committing on blur is existing behaviour. What matters is that a refused
    // value is not lost: `addCandidates` leaves it in the field with a message.
    if (inputValue.trim()) {
      addCandidates(splitCandidateTags(inputValue, Boolean(props.validate)))
    }
  }

  return (
    <div className='grid gap-1.5'>
      <div
        className={cn(
          'border-input focus-within:border-ring focus-within:ring-ring/50 flex min-h-9 w-full flex-wrap items-center gap-2 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-within:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          error && 'border-destructive focus-within:border-destructive',
          props.className
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <Badge key={tag} variant='secondary' className='gap-1 pr-1'>
            {tag}
            {!disabled && (
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={t('Remove tag {{tag}}', { tag })}
                onClick={(e) => {
                  e.stopPropagation()
                  removeTag(tag)
                }}
                className='hover:bg-secondary-foreground/20 size-auto rounded-sm p-0'
              >
                <X className='h-3 w-3' aria-hidden='true' />
              </Button>
            )}
          </Badge>
        ))}
        <input
          ref={inputRef}
          id={props.id}
          type='text'
          value={inputValue}
          list={availableSuggestions.length > 0 ? suggestionsId : undefined}
          aria-describedby={describedBy}
          aria-invalid={props['aria-invalid'] || Boolean(error) || undefined}
          onChange={(e) => {
            setInputValue(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholderText : ''}
          disabled={disabled}
          className='placeholder:text-muted-foreground min-w-[120px] flex-1 border-0 bg-transparent shadow-none outline-none focus-visible:ring-0'
        />
      </div>
      {availableSuggestions.length > 0 && (
        // A native datalist rather than a hand-rolled combobox: the browser
        // supplies the popup, keyboard traversal and filtering, and it degrades
        // to a plain text field where it is unsupported. The existing
        // `ComboboxInput` owns a single value and its own text field, so it
        // cannot host the tag pills this field renders alongside the input.
        <datalist id={suggestionsId}>
          {availableSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
      {error && (
        <p id={errorId} role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
    </div>
  )
}
