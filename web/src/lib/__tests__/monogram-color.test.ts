import { describe, expect, test } from 'vitest'

import { getMonogramColor, getMonogramLetter } from '../monogram-color'

describe('getMonogramColor', () => {
  test('is stable for the same name', () => {
    expect(getMonogramColor('OhMyGPT')).toEqual(getMonogramColor('OhMyGPT'))
  })

  test('ignores case and surrounding whitespace', () => {
    expect(getMonogramColor('  mokaai ')).toEqual(getMonogramColor('MokaAI'))
  })

  test('separates the names that actually rely on it', () => {
    // These three lost their borrowed OpenAI mark; if they collide the column
    // is no more readable than before.
    const names = ['OhMyGPT', 'MokaAI', 'Submodel']
    const backgrounds = new Set(
      names.map((n) => getMonogramColor(n).background)
    )
    expect(backgrounds.size).toBe(names.length)
  })

  test('falls back to neutral grey for empty input', () => {
    expect(getMonogramColor('   ').background).toBe('hsl(220 9% 60%)')
  })

  test('always pairs white text with the hashed background', () => {
    expect(getMonogramColor('anything').foreground).toBe('#fff')
  })
})

describe('getMonogramLetter', () => {
  test('uppercases the first character', () => {
    expect(getMonogramLetter('submodel')).toBe('S')
  })

  test('yields ? for empty input', () => {
    expect(getMonogramLetter('  ')).toBe('?')
  })
})
