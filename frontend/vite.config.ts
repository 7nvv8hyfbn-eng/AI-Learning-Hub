import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolveDataMode } from './src/services/api/data-mode'
declare const process: { env: Record<string, string | undefined> }

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  resolveDataMode(process.env.VITE_DATA_MODE ?? env.VITE_DATA_MODE, command === 'build', mode)
  return {
  plugins: [vue()],
  build: { rollupOptions: { treeshake: { moduleSideEffects: (id) => !id.includes('/packages/demo-fixtures/') && !/\.mock\.ts$/.test(id) } } },
  resolve: { alias: [{ find: /^@ai-learning-hub\/contracts$/, replacement: '@ai-learning-hub/contracts/src/index.ts' }] },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  }
})
