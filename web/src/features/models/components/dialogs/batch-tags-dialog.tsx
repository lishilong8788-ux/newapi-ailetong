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
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { TagInput } from '@/components/tag-input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

import { useTagVocabulary } from '../../hooks/use-tag-vocabulary'
import { createModelTagValidator, handleBatchUpdateModelTags } from '../../lib'

type BatchTagsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelIds: number[]
  onApplied?: () => void
}

export function BatchTagsDialog(props: BatchTagsDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const suggestions = useTagVocabulary()
  const [addTags, setAddTags] = useState<string[]>([])
  const [removeTags, setRemoveTags] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validateTag = useMemo(() => createModelTagValidator(t), [t])

  useEffect(() => {
    if (!props.open) return
    setAddTags([])
    setRemoveTags([])
  }, [props.open])

  const canSubmit =
    props.modelIds.length > 0 &&
    (addTags.length > 0 || removeTags.length > 0) &&
    !isSubmitting

  const onSubmit = async () => {
    setIsSubmitting(true)
    try {
      await handleBatchUpdateModelTags(
        props.modelIds,
        addTags,
        removeTags,
        queryClient,
        () => {
          props.onOpenChange(false)
          props.onApplied?.()
        }
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Edit tags on selected models')}
      description={t(
        'Tags are added to and removed from {{count}} selected model(s). Models that already match are left alone.',
        { count: props.modelIds.length }
      )}
      contentClassName='sm:max-w-lg'
      footerClassName='mt-4'
      contentHeight='auto'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={!canSubmit}>
            {isSubmitting && (
              <Loader2
                className='mr-2 h-4 w-4 animate-spin'
                aria-hidden='true'
              />
            )}
            {t('Apply tags')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='batch-tags-add'>{t('Tags to add')}</Label>
          <TagInput
            id='batch-tags-add'
            value={addTags}
            onChange={setAddTags}
            validate={validateTag}
            suggestions={suggestions}
            disabled={isSubmitting}
            placeholder={t('Add tags...')}
          />
        </div>

        <div className='flex flex-col gap-2'>
          <Label htmlFor='batch-tags-remove'>{t('Tags to remove')}</Label>
          <TagInput
            id='batch-tags-remove'
            value={removeTags}
            onChange={setRemoveTags}
            validate={validateTag}
            suggestions={suggestions}
            disabled={isSubmitting}
            placeholder={t('Add tags...')}
          />
        </div>

        <p className='text-muted-foreground text-sm'>
          {t('Press Enter or comma to add tags')}
        </p>
      </div>
    </Dialog>
  )
}
