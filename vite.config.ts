// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // keep your src alias
      // Route all lottie-web imports to the light player (no eval)
      'lottie-web/build/player/lottie': 'lottie-web/build/player/lottie_light',
      'lottie-web': 'lottie-web/build/player/lottie_light',
    },
  },
  server: {
    port: 5147,
    host: '0.0.0.0',
    https: {
      key: fs.readFileSync('/Users/parisder/letsencrypt/dev.ourglp1.com/privkey.pem'),
      cert: fs.readFileSync('/Users/parisder/letsencrypt/dev.ourglp1.com/fullchain.pem'),
    },
    hmr: mode === 'development' ? { protocol: 'wss', host: 'localhost', port: 5147 } : false,
  },
  build: { outDir: './dist', minify: false, sourcemap: true },
  appType: 'spa',
}));
