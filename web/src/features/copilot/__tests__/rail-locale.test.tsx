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
import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, describe, expect, test } from 'vitest'

import { CopilotRail } from '../components/copilot-rail'
import type { CopilotSession } from '../types'

const SESSION: CopilotSession = {
  id: 1,
  title: '上个月毛利',
  created_time: Math.floor(Date.now() / 1000) - 600,
  updated_time: Math.floor(Date.now() / 1000) - 300,
}

function renderRail() {
  return render(
    <CopilotRail
      sessions={[SESSION]}
      isLoading={false}
      activeSessionId={null}
      mode='ask'
      onModeChange={() => {}}
      onSelectSession={() => {}}
      onDeleteSession={() => {}}
      onNewSession={() => {}}
      onPickExample={() => {}}
    />
  )
}

afterEach(async () => {
  await i18next.changeLanguage('en')
})

/**
 * This project's i18next codes are `zhCN` / `zhTW`, which are NOT valid BCP-47
 * tags — `new Intl.RelativeTimeFormat('zhCN')` throws `RangeError: Invalid
 * language tag`. The rail used to hand `i18n.language` straight to the formatter,
 * so the whole copilot page died with "Invalid language tag: zhCN" as soon as the
 * operator had one conversation in history. Empty history rendered no timestamp
 * and so hid the bug entirely, which is why the session here is the point.
 */
describe('session rail under a non-BCP-47 interface language', () => {
  test.each(['zhCN', 'zhTW', 'en'])('renders with lng=%s', async (lng) => {
    await i18next.changeLanguage(lng)

    expect(() => renderRail()).not.toThrow()
    expect(screen.getByText(SESSION.title)).toBeInTheDocument()
  })
})
