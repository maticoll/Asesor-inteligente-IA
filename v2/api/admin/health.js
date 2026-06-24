/**
 * api/admin/health.js — Estado de las conexiones externas (APIs / IA / BDD).
 *
 * Seguridad: mismo patrón que users.js — requiere token de Clerk válido + rol admin.
 *
 * Estrategia de chequeo (para no gastar cuota ni tokens):
 *   - Yahoo Finance  → ping real gratis (mide latencia).
 *   - Clerk (BDD)    → users.getCount() gratis, valida la secret key y conectividad.
 *   - Alpha Vantage  → solo config (no se pingea: free tier 25 req/día).
 *   - Anthropic      → solo config (no se pingea: gastaría tokens).
 *
 * GET /api/admin/health → { checkedAt, services: { yahoo, clerk, alpha, anthropic } }
 */
import { createClerkClient, verifyToken } from '@clerk/backend';

const secretKey = process.env.CLERK_SECRET_KEY;

// Ejecuta un chequeo y mide latencia, sin lanzar excepciones.
async function timed(fn) {
  const t0 = Date.now();
  try {
    await fn();
    return { status: 'ok', latencyMs: Date.now() - t0, error: null, kind: 'live' };
  } catch (e) {
    return { status: 'down', latencyMs: Date.now() - t0, error: e.message, kind: 'live' };
  }
}

function configCheck(envValue, missingMsg) {
  return envValue
    ? { status: 'configured', latencyMs: null, error: null, kind: 'config' }
    : { status: 'missing', latencyMs: null, error: missingMsg, kind: 'config' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!secretKey) return res.status(500).json({ error: 'CLERK_SECRET_KEY no configurada' });

  // ── Auth: token válido + rol admin ───────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Falta el token de sesión' });

  let claims;
  try {
    claims = await verifyToken(token, { secretKey });
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const clerk = createClerkClient({ secretKey });

  let me;
  try {
    me = await clerk.users.getUser(claims.sub);
  } catch {
    return res.status(401).json({ error: 'Usuario no encontrado' });
  }
  if (me.publicMetadata?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }

  // ── Chequeos ─────────────────────────────────────────────────────────────────
  const services = {};

  // Yahoo Finance — ping real (gratis)
  services.yahoo = await timed(async () => {
    const r = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d',
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });

  // Clerk — getCount (gratis, valida secret key + conectividad)
  services.clerk = await timed(async () => {
    await clerk.users.getCount();
  });

  // Alpha Vantage — solo config (no gastar cuota)
  services.alpha = configCheck(
    process.env.ALPHA_VANTAGE_API_KEY,
    'ALPHA_VANTAGE_API_KEY no configurada',
  );

  // Anthropic (Claude) — solo config (no gastar tokens)
  services.anthropic = configCheck(
    process.env.ANTHROPIC_API_KEY,
    'ANTHROPIC_API_KEY no configurada',
  );

  return res.status(200).json({
    checkedAt: new Date().toISOString(),
    services,
  });
}
