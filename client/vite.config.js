import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Toutes les routes API sont proxiées vers le backend en dev.
// En production, le build va dans ../dist/ et c'est Node qui sert les fichiers.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api':          { target: 'http://localhost:3350', changeOrigin: true },
      '/levels':       { target: 'http://localhost:3350', changeOrigin: true },
      '/status':       { target: 'http://localhost:3350', changeOrigin: true },
      '/bot-info':     { target: 'http://localhost:3350', changeOrigin: true },
      '/bot-token':    { target: 'http://localhost:3350', changeOrigin: true },
      '/frames':       { target: 'http://localhost:3350', changeOrigin: true },
      '/images':       { target: 'http://localhost:3350', changeOrigin: true },
      '/upload':       { target: 'http://localhost:3350', changeOrigin: true },
      '/reorder':      { target: 'http://localhost:3350', changeOrigin: true },
      '/delete-frame': { target: 'http://localhost:3350', changeOrigin: true },
      '/move-frame':   { target: 'http://localhost:3350', changeOrigin: true },
      '/user-config':  { target: 'http://localhost:3350', changeOrigin: true },
      '/calibration':  { target: 'http://localhost:3350', changeOrigin: true },
      '/known-users':  { target: 'http://localhost:3350', changeOrigin: true },
      '/delete-user':  { target: 'http://localhost:3350', changeOrigin: true },
      '/invite':       { target: 'http://localhost:3350', changeOrigin: true },
      '/auth': {
        target: 'http://localhost:3350',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
      },
    },
  },
  build: {
    // Output dans dist/ à la racine du projet (servi par Node)
    outDir: '../dist',
    emptyOutDir: true,
  },
})
