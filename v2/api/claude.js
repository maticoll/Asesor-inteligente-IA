/**
 * api/claude.js — Proxy server-side para la API de Anthropic (orquestador)
 * La API key vive en las env vars de Vercel, nunca llega al cliente.
 *
 * POST /api/claude
 * Body: { system, messages, max_tokens? }
 *   → reenvía a /v1/messages de Anthropic con model claude-sonnet-4-6
 *   → devuelve la respuesta tal cual
 */

import { enforceRateLimit } from './_ratelimit.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL  = 'claude-sonnet-4-6';
const DEFAULT_TOKENS = 4096;

export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit: protege contra abuso/costo de la API de Claude.
  // 10 análisis por minuto y por IP (un análisis = 1 llamada al LLM).
  if (!enforceRateLimit(req, res, { bucket: 'claude', limit: 10, windowMs: 60_000 })) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en Vercel' });
  }

  const { system, messages, max_tokens } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body debe incluir messages (array no vacío)' });
  }

  const payload = {
    model:      DEFAULT_MODEL,
    max_tokens: max_tokens || DEFAULT_TOKENS,
    messages,
    ...(system ? { system } : {}),
  };

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return res.status(502).json({ error: `Claude proxy error: ${err.message}` });
  }

  const body = await upstream.json();
  return res.status(upstream.status).json(body);
}
