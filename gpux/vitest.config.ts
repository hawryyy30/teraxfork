import { defineConfig } from 'vitest/config'

/**
 * Pins the test root to gpux/ so vitest does not climb into the parent
 * Terax repo's vite.config.ts (whose dev deps are not installed here).
 */
export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
})
