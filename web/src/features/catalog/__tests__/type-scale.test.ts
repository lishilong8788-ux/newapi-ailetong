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
 * The catalog's type floor.
 *
 * This page packs a lot into two panes, and the first version answered that by
 * shrinking text to 10 and 11 pixels — small enough that the prices, the figures
 * the page exists to show, could not be read at a glance. A second pass landed on
 * 13px, which was still under the app sidebar's own 14px, so the page read as
 * smaller than the chrome around it.
 *
 * The floor is now 13px, reserved for badges and suffix annotations, with body
 * text and every figure at `text-sm` (14px) to match the sidebar. Both halves are
 * asserted rather than left to review: the pressure that produced the small sizes
 * (one more column, one more annotation) applies to every future change, and a
 * floor alone does not stop a page from sitting entirely on the floor.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const FEATURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Arbitrary-value font sizes, e.g. `text-[13px]`. */
const ARBITRARY_SIZE = /text-\[(\d+)px\]/g

/** The smallest size allowed anywhere on the page, in pixels. */
const FLOOR_PX = 13

/** Tailwind's named sizes, in the pixels they compile to. */
const NAMED_PX = new Map([
  ['text-xs', 12],
  ['text-sm', 14],
  ['text-base', 16],
  ['text-lg', 18],
  ['text-xl', 20],
])

/** Resolves either spelling of a font size to pixels; 0 when unrecognised. */
function sizeToPx(className: string | undefined): number {
  if (!className) return 0
  const arbitrary = /^text-\[(\d+)px\]$/.exec(className)
  if (arbitrary) return Number(arbitrary[1])
  return NAMED_PX.get(className) ?? 0
}

function collectTsxFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      files.push(...collectTsxFiles(full))
      continue
    }
    if (entry.name.endsWith('.tsx')) files.push(full)
  }
  return files
}

describe('catalog type scale', () => {
  it('uses no font size below the floor', () => {
    const offenders: string[] = []

    for (const file of collectTsxFiles(FEATURE_DIR)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(ARBITRARY_SIZE)) {
        if (Number(match[1]) >= FLOOR_PX) continue
        offenders.push(`${path.relative(FEATURE_DIR, file)}: ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('does not use text-xs, which is below the floor', () => {
    // `text-xs` is 12px. It is spelled as a named class rather than an arbitrary
    // value, so the scan above cannot see it — and it is the exact class the first
    // two passes of this page defaulted to.
    const offenders = collectTsxFiles(FEATURE_DIR).filter((file) =>
      /\btext-xs\b/.test(fs.readFileSync(file, 'utf8'))
    )

    expect(offenders.map((file) => path.relative(FEATURE_DIR, file))).toEqual([])
  })

  it('never truncates a model name anywhere on the page', () => {
    // A model name is an identifier an operator matches character by character
    // against an upstream console. Every place one is rendered — the rail, the
    // detail heading, the supply rows, both dialogs — wraps instead of clipping.
    // Only the numeric price cells may clip, and they are named here so adding a
    // `truncate` to a name site fails rather than quietly joining the exception.
    const PRICE_CELL_EXCEPTIONS = 2
    let truncates = 0

    for (const file of collectTsxFiles(FEATURE_DIR)) {
      const source = fs.readFileSync(file, 'utf8')
      // Skip the word inside prose comments explaining why it is not used.
      const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      truncates += code.match(/\btruncate\b/g)?.length ?? 0
    }

    expect(truncates).toBe(PRICE_CELL_EXCEPTIONS)
  })

  it('keeps the model name above the rail body scale', () => {
    // The body scale is a preference and has moved several times. What does not move
    // is the relationship: the rail's model name is the one string on the page read
    // character by character, and a monospace face reads optically smaller than the
    // sans text beside it, so the name sits above whatever the body happens to be.
    // Compared as pixels rather than pinned to a class, so a future density pass can
    // shrink the page without flattening the name into it — and without editing this
    // test, which is what makes it a guard rather than a copy of the current value.
    const rail = fs.readFileSync(
      path.join(FEATURE_DIR, 'components', 'catalog-sidebar.tsx'),
      'utf8'
    )

    const namePx = sizeToPx(
      /font-mono (text-\S+) leading-6 wrap-anywhere/.exec(rail)?.[1]
    )
    // The channel count sits beside the name and tracks the rail's body scale.
    const bodyPx = sizeToPx(
      /shrink-0 (text-\S+) leading-6 tabular-nums/.exec(rail)?.[1]
    )

    expect(namePx).toBeGreaterThan(0)
    expect(bodyPx).toBeGreaterThan(0)
    expect(namePx).toBeGreaterThan(bodyPx)
  })

  it('renders every component file it ships, so the scan cannot pass by being empty', () => {
    // A regex assertion over a file list is only as good as the list. Without
    // this, deleting the components directory would make the test above pass.
    const files = collectTsxFiles(FEATURE_DIR)

    expect(files.length).toBeGreaterThan(5)
  })
})
