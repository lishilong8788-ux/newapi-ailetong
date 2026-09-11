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

/**
 * Axis colours for this page's charts, matching the tokens the agent-analytics
 * charts already use so both analysis pages sit consistently in both themes.
 */
export function chartAxisTokens(resolvedTheme: string) {
  const textColor =
    resolvedTheme === 'dark'
      ? 'rgba(255, 255, 255, 0.68)'
      : 'rgba(15, 23, 42, 0.58)'

  return {
    textColor,
    gridColor:
      resolvedTheme === 'dark'
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(15, 23, 42, 0.12)',
    titleStyle: { fill: textColor, fontSize: 11 },
  }
}

/**
 * Reads a field off a VChart tooltip datum.
 *
 * VChart hands tooltip callbacks an untyped `Datum`, so every accessor has to
 * narrow before use; these two keep that narrowing in one place instead of
 * repeating it in four chart specs.
 */
export function datumString(datum: unknown, field: string): string {
  if (datum && typeof datum === 'object' && field in datum) {
    return String((datum as Record<string, unknown>)[field] ?? '')
  }
  return ''
}

export function datumNumber(datum: unknown, field: string): number {
  if (datum && typeof datum === 'object' && field in datum) {
    return Number((datum as Record<string, unknown>)[field]) || 0
  }
  return 0
}
