/**
 * api/admin/users.js — Lista de usuarios para el panel de administración.
 *
 * Seguridad (defensa en profundidad):
 *   1. Requiere un token de sesión de Clerk (Authorization: Bearer <token>).
 *   2. Verifica el token server-side con la SECRET KEY (nunca llega al cliente).
 *   3. Solo responde si el usuario tiene publicMetadata.role === 'admin'.
 *
 * GET /api/admin/users  →  { users: [...], total: n }
 */
import { createClerkClient, verifyToken } from '@clerk/backend';

const secretKey = process.env.CLERK_SECRET_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!secretKey) {
    return res.status(500).json({ error: 'CLERK_SECRET_KEY no configurada' });
  }

  // 1. Extraer el token
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Falta el token de sesión' });
  }

  // 2. Verificar el token
  let claims;
  try {
    claims = await verifyToken(token, { secretKey });
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const clerk = createClerkClient({ secretKey });

  // 3. Chequear rol admin
  let me;
  try {
    me = await clerk.users.getUser(claims.sub);
  } catch {
    return res.status(401).json({ error: 'Usuario no encontrado' });
  }
  if (me.publicMetadata?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }

  // 4. Devolver la lista (campos mínimos, sin datos sensibles de más)
  try {
    const list = await clerk.users.getUserList({ limit: 100, orderBy: '-created_at' });
    const rows = (list.data ?? list).map((u) => ({
      id: u.id,
      email: u.emailAddresses?.[0]?.emailAddress ?? null,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      imageUrl: u.imageUrl ?? null,
      role: u.publicMetadata?.role ?? 'user',
      createdAt: u.createdAt ?? null,
      lastSignInAt: u.lastSignInAt ?? null,
    }));
    return res.status(200).json({ users: rows, total: list.totalCount ?? rows.length });
  } catch (err) {
    return res.status(502).json({ error: `Error consultando Clerk: ${err.message}` });
  }
}
