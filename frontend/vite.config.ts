import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      // Video, HLS playlists/segments and subtitles are served by the backend
      // too. Without these, `npm run dev` answers 404 for every video request
      // and nothing plays outside Docker, where nginx does the proxying.
      '/media': { target: 'http://localhost:3001', changeOrigin: true },
      '/hls-mkv': { target: 'http://localhost:3001', changeOrigin: true },
      '/subs': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
