import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = process.env.PORT ?? '4700';
const target = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    // In dev the UI is served by Vite and the API by the Node server, so both
    // the REST calls and the socket are proxied to keep everything same-origin.
    proxy: {
      '/api': { target, changeOrigin: true },
      '/media': { target, changeOrigin: true },
      '/socket.io': { target, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
