import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Scoped config for pure-logic suites.
 *
 * The default config boots jsdom and `src/test-setup.ts`, which stubs
 * `window.matchMedia` and friends. Suites that only exercise plain functions do
 * not need a DOM, and loading one drags in `html-encoding-sniffer` — a
 * transitive jsdom dependency that currently fails under `require()` with
 * ERR_REQUIRE_ESM. Running these on the node environment keeps them green
 * regardless of that breakage.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    include: ['src/features/playground/lib/capability/**/*.{test,spec}.ts'],
  },
})
