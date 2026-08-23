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
import {
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputHeader,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'

/**
 * Renders the pasted/picked image chips above the textarea, and stays out of
 * the layout entirely while nothing is attached.
 */
export function PlaygroundInputAttachments() {
  const attachments = usePromptInputAttachments()

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <PromptInputHeader className='border-border/60 bg-muted/20 dark:bg-muted/10 border-b px-3 py-2'>
      <PromptInputAttachments>
        {(attachment) => (
          <PromptInputAttachment data={attachment} key={attachment.id} />
        )}
      </PromptInputAttachments>
    </PromptInputHeader>
  )
}
