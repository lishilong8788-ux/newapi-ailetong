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
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isLikelyHtml(value: string): boolean {
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<script[\s>]|<\/?[a-z][\s\S]*>/i.test(
    value
  )
}

/**
 * Admin-authored HTML (custom home page, about page) renders in a shadow root
 * beneath the transparent floating header and cannot style it across the shadow
 * boundary. Opting in with `data-nav-tone="invert"` anywhere in the markup lets
 * such content declare that its top region is dark, so the header can switch to
 * a light-on-dark treatment instead of forcing the page to fade its hero to a
 * light band just to keep the nav legible.
 */
export function requestsInvertedNav(value: string): boolean {
  return /data-nav-tone\s*=\s*["']?invert/i.test(value)
}
