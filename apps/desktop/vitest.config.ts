import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['protected/**/*.test.ts', 'protected/**/*.test.js', 'src/protected/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['scripts/build-office-reader.mjs']
  }
})
