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
  BadgeCheck,
  Eye,
  PauseCircle,
  Percent,
  PlayCircle,
  Users,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { AgentListItem } from '../types'
import { useAgents } from './agents-provider'

type AgentRowActionsProps = {
  agent: AgentListItem
}

/**
 * Row actions for one agent, keyed off its state.
 *
 * Flat icon buttons rather than a dropdown menu: Base UI's menu popup loops
 * under jsdom, so a menu here would make every fixture with a populated actions
 * column untestable — and this table's row actions are the ones worth covering.
 * Each button carries its own accessible name; the icons are decorative.
 */
export function AgentRowActions(props: AgentRowActionsProps) {
  const { t } = useTranslation()
  const { setOpen, setCurrentAgent, setAuditApproval, setBatchAgents } =
    useAgents()

  const status = props.agent.status
  const canAudit = status === 'pending'
  const canSuspend = status === 'active'
  const canReactivate = status === 'suspended'

  const openDialog = (
    dialog: Parameters<typeof setOpen>[0],
    approve?: boolean
  ) => {
    setCurrentAgent(props.agent)
    // A row action is always single-target; clearing the batch keeps a stale
    // selection from widening what the dialog acts on.
    setBatchAgents([])
    if (approve !== undefined) setAuditApproval(approve)
    setOpen(dialog)
  }

  return (
    <div className='-ms-1.5 flex items-center gap-0.5'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='sm'
              className='size-7 p-0'
              aria-label={t('View agent detail')}
              onClick={() => openDialog('agent-detail')}
            />
          }
        >
          <Eye className='size-3.5' aria-hidden='true' />
        </TooltipTrigger>
        <TooltipContent>{t('View agent detail')}</TooltipContent>
      </Tooltip>

      {canAudit && (
        <>
          <Button
            size='sm'
            className='h-7'
            onClick={() => openDialog('agent-audit', true)}
          >
            <BadgeCheck className='size-3.5' aria-hidden='true' />
            {t('Approve')}
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive hover:text-destructive size-7 p-0'
                  aria-label={t('Reject agent application')}
                  onClick={() => openDialog('agent-audit', false)}
                />
              }
            >
              <XCircle className='size-3.5' aria-hidden='true' />
            </TooltipTrigger>
            <TooltipContent>{t('Reject agent application')}</TooltipContent>
          </Tooltip>
        </>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='sm'
              className='size-7 p-0'
              aria-label={t('Adjust commission rate')}
              onClick={() => openDialog('agent-rate')}
            />
          }
        >
          <Percent className='size-3.5' aria-hidden='true' />
        </TooltipTrigger>
        <TooltipContent>{t('Adjust commission rate')}</TooltipContent>
      </Tooltip>

      {canSuspend && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='sm'
                className='text-destructive hover:text-destructive size-7 p-0'
                aria-label={t('Suspend agent')}
                onClick={() => openDialog('agent-status')}
              />
            }
          >
            <PauseCircle className='size-3.5' aria-hidden='true' />
          </TooltipTrigger>
          <TooltipContent>{t('Suspend agent')}</TooltipContent>
        </Tooltip>
      )}

      {canReactivate && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='sm'
                className='size-7 p-0'
                aria-label={t('Reactivate agent')}
                onClick={() => openDialog('agent-status')}
              />
            }
          >
            <PlayCircle className='size-3.5' aria-hidden='true' />
          </TooltipTrigger>
          <TooltipContent>{t('Reactivate agent')}</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='sm'
              className='size-7 p-0'
              aria-label={t('View customers')}
              onClick={() => openDialog('agent-detail')}
            />
          }
        >
          <Users className='size-3.5' aria-hidden='true' />
        </TooltipTrigger>
        <TooltipContent>{t('View customers')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
