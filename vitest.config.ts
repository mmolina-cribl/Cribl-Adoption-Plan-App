import { defineConfig } from 'vitest/config'
import { appVersionFromPackageJsonPlugin } from './vite-app-version-plugin.ts'

export default defineConfig({
  plugins: [appVersionFromPackageJsonPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
