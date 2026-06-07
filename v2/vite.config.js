import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Adapta res de Node.js al contrato Vercel/Express usado en api/*.js
function wrapRes(nodeRes) {
  let _status = 200;
  const mock = {
    setHeader: (k, v) => nodeRes.setHeader(k, v),
    status(code) {
      _status = code;
      nodeRes.statusCode = code;
      return mock;
    },
    json(data) {
      if (!nodeRes.getHeader('Content-Type')) {
        nodeRes.setHeader('Content-Type', 'application/json');
      }
      nodeRes.end(JSON.stringify(data));
    },
    end: (data) => nodeRes.end(data),
  };
  return mock;
}

// Plugin que monta api/*.js como middleware local (equivalente a vercel dev)
function vercelApiPlugin() {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        const handlers = {
          '/api/yahoo': () => import('./api/yahoo.js'),
          '/api/alpha': () => import('./api/alpha.js'),
          '/api/claude': () => import('./api/claude.js'),
        };

        const load = handlers[url.pathname];
        if (!load) return next();

        req.query = Object.fromEntries(url.searchParams);

        try {
          const { default: handler } = await load();
          await handler(req, wrapRes(res));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), vercelApiPlugin()],
  server: {
    port: 3000,
    open: true,
  },
});
