/**
 * api/_auth.js — Autenticación y CORS para los endpoints de datos.
 *
 * - requireAuth: exige un token de sesión de Clerk válido (verificado server-side
 *   con la SECRET KEY). Cierra el riesgo de que los endpoints pagos (Claude, Alpha)
 *   sean invocados por usuarios no autenticados.
 * - applyCors: restringe CORS a una allowlist de orígenes propios (en vez de "*"),
 *   evitando que otros sitios usen la API como proxy abierto desde el navegador.
 *
 * Los archivos con prefijo "_" no son tratados como rutas por Vercel.
 */
import { verifyToken } from '@clerk/backend';

const secretKey = process.env.CLERK_SECRET_KEY;

// Orígenes permitidos. El front es same-origin en producción; esta lista bloquea
// el uso cross-origin de la API desde otros dominios. Extender con el dominio propio
// si se compra uno (ver variable de entorno opcional).
const ALLOWED_ORIGINS = [
  'https://asesor-inteligente-ia.vercel.app',
  'http://localhost:3000',
  ...(process.env.PUBLIC_APP_ORIGIN ? [process.env.PUBLIC_APP_ORIGIN] : []),
];

export function applyCors(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Verifica el token de sesión de Clerk.
 * @returns {Promise<{userId: string} | null>} claims si es válido; si no, ya respondió 401/500 y devuelve null.
 */
export async function requireAuth(req, res) {
  const path = req.url || '?';

  if (!secretKey) {
    console.error(`[auth] ${path} — CLERK_SECRET_KEY ausente en el entorno del servidor`);
    res.status(500).json({ error: 'CLERK_SECRET_KEY no configurada en el servidor' });
    return null;
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    // Distinguir "no mandó header" de "mandó header pero no es Bearer".
    console.warn(
      `[auth] ${path} — sin token. authorization header ${header ? 'presente pero sin formato Bearer' : 'ausente'}`,
    );
    res.status(401).json({ error: 'Autenticación requerida' });
    return null;
  }

  try {
    const claims = await verifyToken(token, { secretKey });
    return { userId: claims.sub };
  } catch (err) {
    // Causa real al log de Vercel (no al cliente). Típicamente:
    //  - "token-invalid-signature" / clave que no corresponde a la instancia (mismatch pk/sk)
    //  - "token-expired" / clock skew
    console.error(
      `[auth] ${path} — verifyToken falló: ${err?.reason || err?.message || err}`,
    );
    res.status(401).json({ error: 'Token inválido o expirado' });
    return null;
  }
}
