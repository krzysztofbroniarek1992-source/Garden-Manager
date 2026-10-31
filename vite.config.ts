import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: 'Garden Manager', short_name: 'Garden', description: 'Twoja firma ogrodnicza w jednym miejscu',
      lang: 'pl', theme_color: '#153e35', background_color: '#f6f7f5', display: 'standalone', start_url: '/',
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2,ttf}'], navigateFallback: '/index.html' },
  })],
  build: { rollupOptions: { output: {
    // Keep the growing application bundle small; PWA also precaches this chunk.
    manualChunks: id => /\/node_modules\/(react(?:-dom)?|scheduler)\//.test(id) ? 'react-vendor' : id.includes('/node_modules/@pdf-lib/fontkit/') ? 'pdf-fontkit' : id.includes('/node_modules/pdf-lib/') ? 'pdf-engine' : undefined,
  } } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
