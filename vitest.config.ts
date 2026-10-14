import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    // Run test files one at a time in a single forked process. The default
    // spawns a worker per file, which times out on constrained machines; these
    // tests are pure functions, so parallel workers buy nothing.
    pool: 'forks',
    fileParallelism: false,
  },
})
