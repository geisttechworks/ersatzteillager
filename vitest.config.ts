import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['tests/e2e/**', '**/.factory-verification/**', '**/node_modules/**', '**/dist/**'],
  },
})
