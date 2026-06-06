import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        secure: true,
      },
      '/api/alpha': {
        target: 'https://www.alphavantage.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/alpha/, '/query'),
        secure: true,
      },
    },
  },
});
