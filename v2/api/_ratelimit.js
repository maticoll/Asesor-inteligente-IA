/**
 * api/_ratelimit.js — Limitador de tasa en memoria (ventana deslizante).
 *
 * Mitiga ráfagas de abuso contra los endpoints caros (Claude, Alpha Vantage):
 * evita que un usuario dispare muchas llamadas seguidas y agote tokens/cuota.
 *
 * Limitación conocida: el estado vive en memoria POR INSTANCIA serverless.
 * Sirve contra ráfagas, pero no es un límite global estricto entre instancias.
 * Para producción robusta: Upstash Redis o Vercel KV con @upstash/ratelimit.
 *
 * Los archivos con prefijo "_" no son tratados como rutas por Vercel.
 */

const buckets = new Map(); // identifier -> number[] (timestamps de hits)

/** IP del cliente a partir de los headers de Vercel. */
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * Registra un hit y dice si está permitido.
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
    buckets.set(key, hits);
    return { allowed: false, remaining: 0, retryAfter };
  }

  hits.push(now);
  buckets.set(key, hits);

  // Limpieza oportunista para que el Map no crezca sin límite.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }

  return { allowed: true, remaining: limit - hits.length, retryAfter: 0 };
}

/**
 * Aplica el límite y, si se excede, responde 429 con Retry-After.
 * @returns {boolean} true si la request puede continuar.
 */
export function enforceRateLimit(req, res, { bucket, limit, windowMs }) {
  const { allowed, remaining, retryAfter } = rateLimit({
    key: `${bucket}:${clientIp(req)}`,
    limit,
    windowMs,
  });

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));

  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: `Demasiadas solicitudes. Esperá ${retryAfter}s e intentá de nuevo.`,
    });
    return false;
  }
  return true;
}
