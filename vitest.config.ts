import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
      environment: 'node',
      // UI tests opt into DOM via `// @vitest-environment happy-dom`
      restoreMocks: true,
    },
  }),
)
