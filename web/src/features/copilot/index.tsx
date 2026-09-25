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
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'

import { CopilotComposer } from './components/copilot-composer'
import { CopilotDeleteDialog } from './components/copilot-delete-dialog'
import {
  CopilotHeader,
  CopilotNotConfiguredNotice,
} from './components/copilot-header'
import { CopilotModelPicker } from './components/copilot-model-picker'
import { CopilotRail } from './components/copilot-rail'
import { CopilotThread } from './components/copilot-thread'
import { useCopilotConversation } from './hooks'
import type { CopilotSession } from './types'

/**
 * 运营副驾 — an admin-only conversational lens on this install's own numbers.
 *
 * Two panes: history and seed prompts on the left, the transcript and composer on
 * the right. The transcript is not just prose — every tool call the model made is
 * rendered as a step with its duration and outcome, which is the only way an admin
 * can tell a figure that was queried from one that was invented.
 */
export function Copilot() {
  const { t } = useTranslation()
  const conversation = useCopilotConversation()
  const [draft, setDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<CopilotSession | null>(
    null
  )

  const isBlocked = !conversation.isConfigured

  const handleSubmit = useCallback(
    (images: string[]) => {
      const message = draft.trim()
      // Images without text is a real question ("what's wrong with this table?"),
      // so an empty draft only blocks the send when nothing is attached either.
      if ((!message && images.length === 0) || isBlocked) return

      setDraft('')
      void conversation.sendMessage(message, images)
    },
    [conversation, draft, isBlocked]
  )

  const handleNewSession = useCallback(() => {
    conversation.startNewSession()
    setDraft('')
  }, [conversation])

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Ops Copilot')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(220px,260px)_1fr]'>
          <CopilotRail
            sessions={conversation.sessions}
            isLoading={conversation.isSessionsLoading}
            activeSessionId={conversation.sessionId}
            onSelectSession={(id) => void conversation.loadSession(id)}
            onDeleteSession={setPendingDelete}
            onNewSession={handleNewSession}
            onPickExample={setDraft}
            className='hidden lg:flex'
          />

          <div className='bg-card flex min-h-0 flex-col overflow-hidden rounded-xl border'>
            <CopilotHeader onNewSession={handleNewSession} />

            {isBlocked && (
              <CopilotNotConfiguredNotice
                hasModel={Boolean(conversation.status?.model)}
                canConfigure={conversation.status?.can_configure ?? false}
              />
            )}

            <CopilotThread
              turns={conversation.turns}
              isLoading={conversation.isHistoryLoading}
              isStreaming={conversation.isStreaming}
              onPickExample={setDraft}
            />

            <div className='shrink-0 border-t p-3'>
              <div className='mx-auto w-full max-w-3xl'>
                <CopilotComposer
                  value={draft}
                  onChange={setDraft}
                  onSubmit={handleSubmit}
                  onStop={conversation.stopStreaming}
                  isStreaming={conversation.isStreaming}
                  disabled={isBlocked}
                  picker={
                    <CopilotModelPicker
                      status={conversation.status}
                      models={conversation.models}
                      group={conversation.modelGroup}
                      isLoading={conversation.isModelsLoading}
                      isSaving={conversation.isSavingConfig}
                      onSave={conversation.saveConfig}
                    />
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <CopilotDeleteDialog
          session={pendingDelete}
          onOpenChange={(open) => !open && setPendingDelete(null)}
          isDeleting={conversation.isDeletingSession}
          onConfirm={() => {
            if (!pendingDelete) return
            conversation.deleteSession(pendingDelete.id)
            setPendingDelete(null)
          }}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
