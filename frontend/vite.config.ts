import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_PORT || '9000'),
      host: '127.0.0.1',
      strictPort: true,
      proxy: { '/api': env.EDITOR_API_PROXY || 'http://127.0.0.1:9001' },
    },
    preview: {
      port: parseInt(env.VITE_PORT || '9000'),
      host: '127.0.0.1',
      proxy: { '/api': env.EDITOR_API_PROXY || 'http://127.0.0.1:9001' },
    },
  }
})
