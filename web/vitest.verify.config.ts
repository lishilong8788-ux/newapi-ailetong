import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/features/pricing/__tests__/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: { inline: [/@lobehub\/ui/, /@emoji-mart/, /emoji-mart/] },
    },
  },
})
