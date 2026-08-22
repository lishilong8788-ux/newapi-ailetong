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
import { PublicHeader } from '@/components/layout'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='relative grid min-h-svh max-w-none'>
      {/* The header carries the logo/site name itself, so this layout no longer
          renders its own. Auth buttons are dropped: a "Sign in" chip on the
          sign-in page is noise, and each form already links to its counterpart.
          Notifications are dropped too — announcements are for people who are
          already in, not for the gate. */}
      <PublicHeader showAuthButtons={false} showNotifications={false} />
      <div className='container flex items-center pt-20 sm:pt-16'>
        <div className='mx-auto flex w-full flex-col justify-center space-y-2 px-4 py-8 sm:w-[480px] sm:p-8'>
          {children}
        </div>
      </div>
    </div>
  )
}
