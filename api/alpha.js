/**
 * api/alpha.js — Proxy server-side para Alpha Vantage
 * La API key vive en las env vars de Vercel, nunca llega al cliente.
 *
 * Uso desde el cliente:
 *   GET /api/alpha?function=OVERVIEW&symbol=AAPL
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ALPHA_VANTAGE_API_KEY no configurada en Vercel' });
  }

  const { function: fn, symbol } = req.query;
  if (!fn || !symbol) {
    return res.status(400).json({ error: 'Faltan parámetros: function y symbol son requeridos' });
  }

  try {
    const url = `https://www.alphavantage.co/query?function=${fn}&symbol=${symbol}&apikey=${apiKey}`;
    const upstream = await fetch(url);
    const body = await upstream.json();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: `Alpha Vantage proxy error: ${err.message}` });
  }
}
