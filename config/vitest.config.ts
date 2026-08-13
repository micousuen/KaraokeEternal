import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, 'build/**'],
    setupFiles: [path.resolve(__dirname, '../server/lib/test-setup.ts')],
  },
})
