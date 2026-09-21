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
import { createFileRoute } from '@tanstack/react-router'
import z from 'zod'

import { GeneralError } from '@/features/errors/general-error'

/**
 * Reached by a link or a manual URL, never by the app throwing: the error a
 * route threw is handed straight to `errorComponent`, which knows its status.
 * `?status=` exists so a caller that does route here can still say what
 * happened instead of having this page assert a server fault it cannot see.
 */
const errorPageSearchSchema = z.object({
  status: z.number().int().min(100).max(599).optional().catch(undefined),
})

export const Route = createFileRoute('/(errors)/500')({
  validateSearch: errorPageSearchSchema,
  component: RouteComponent,
})

function RouteComponent() {
  const { status } = Route.useSearch()
  return <GeneralError status={status ?? 500} />
}
