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
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll } from 'vitest'

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {},
      },
    },
  })
})

afterEach(() => {
  cleanup()
})

/*
 * `localStorage` is undefined under Node 26 + jsdom, and neither half is at
 * fault on its own.
 *
 * Node 26 ships its own experimental `localStorage` global, gated behind
 * `--localstorage-file`. Without that flag the property still exists on
 * `globalThis` — its descriptor is present — but reading it yields `undefined`
 * and Node prints "localStorage is not available because --localstorage-file
 * was not provided". That definition wins over the one jsdom installs, so every
 * suite touching persisted state saw `undefined.setItem`: this playground
 * storage suite, plus the redemption-code and API-key drawers through
 * zustand/persist.
 *
 * It is not the opaque-origin failure it resembles — the test origin is a real
 * `http://localhost:3000`, and `SecurityError` is never thrown. Setting
 * `environmentOptions.jsdom.url` therefore changes nothing; vitest already
 * defaults to that origin.
 *
 * The polyfill is a plain in-memory Storage: jsdom's own implementation is not
 * reachable here, and the spec surface tests use is small. Methods live on
 * `Storage.prototype` so that `vi.spyOn(Storage.prototype, 'setItem')` — how
 * suites simulate a quota rejection — still intercepts the call.
 */
function installMemoryStorage(key: 'localStorage' | 'sessionStorage'): void {
  if (typeof globalThis[key]?.setItem === 'function') {
    return
  }

  const entries = new Map<string, string>()

  Object.defineProperties(Storage.prototype, {
    getItem: {
      configurable: true,
      writable: true,
      value: (name: string) => entries.get(String(name)) ?? null,
    },
    setItem: {
      configurable: true,
      writable: true,
      value: (name: string, value: string) => {
        entries.set(String(name), String(value))
      },
    },
    removeItem: {
      configurable: true,
      writable: true,
      value: (name: string) => {
        entries.delete(String(name))
      },
    },
    clear: {
      configurable: true,
      writable: true,
      value: () => entries.clear(),
    },
    key: {
      configurable: true,
      writable: true,
      value: (index: number) => [...entries.keys()][index] ?? null,
    },
    length: {
      configurable: true,
      get: () => entries.size,
    },
  })

  const storage = Object.create(Storage.prototype) as Storage

  for (const target of [globalThis, window]) {
    Object.defineProperty(target, key, {
      configurable: true,
      get: () => storage,
    })
  }
}

installMemoryStorage('localStorage')
installMemoryStorage('sessionStorage')

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

window.requestAnimationFrame = (callback: FrameRequestCallback) =>
  window.setTimeout(() => callback(performance.now()), 0)
window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => undefined,
})
