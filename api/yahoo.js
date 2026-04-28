/**
 * api/yahoo.js — Proxy server-side para Yahoo Finance
 * Resuelve el problema de CORS al llamar desde el browser.
 * No requiere API key (Yahoo Finance es público).
 *
 * URL esperada desde el cliente:
 *   /api/yahoo/v8/finance/chart/AAPL?range=1y&interval=1d
 *   → reescrito vía vercel.json a este handler
 *
 * En el handler, req.query.path contiene el subpath capturado.
 */
export default async function handler(req, res) {
  // Construir el path completo desde el query param inyectado por el rewrite
  const subpath = req.query.path || '';
  const qs = new URLSearchParams(req.query);
  qs.delete('path');

  const targetUrl = `https://query1.finance.yahoo.com/${subpath}${qs.toString() ? `?${qs}` : ''}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    const body = await upstream.json();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: `Yahoo Finance proxy error: ${err.message}` });
  }
}
