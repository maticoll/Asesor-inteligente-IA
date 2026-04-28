/**
 * api/claude.js — Proxy server-side para la API de Anthropic (Claude)
 * La API key vive en las env vars de Vercel, nunca llega al cliente.
 * Elimina la necesidad del header anthropic-dangerous-direct-browser-access.
 *
 * Uso desde el cliente:
 *   POST /api/claude
 *   Body: mismo payload que /v1/messages (model, messages, system, max_tokens)
 */
export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en Vercel' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: `Claude proxy error: ${err.message}` });
  }
}
