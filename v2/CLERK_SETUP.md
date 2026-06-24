# Setup de autenticación con Clerk — StockWise

El código de auth ya está integrado. Estos son los pasos manuales que faltan (todo gratis, ~10 min).

## 1. Crear la cuenta y la app en Clerk

1. Entrá a https://clerk.com → **Sign up** (podés usar tu Google).
2. **Create application** → nombre: `StockWise`.
3. Elegí los métodos de login (ej. Email + Google). **Create**.

## 2. Copiar las API keys

En el dashboard de Clerk → **API Keys**:

- **Publishable key** → empieza con `pk_test_...`
- **Secret key** → empieza con `sk_test_...` (esta es secreta, nunca va al cliente)

## 3. Cargar las keys localmente

En `v2/.env.local` (ya existe, ignorado por git) completá:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxx
```

## 4. Cargar las keys en Vercel (producción)

Vercel → tu proyecto → **Settings → Environment Variables**. Agregá las dos:

| Name | Value | Notas |
|------|-------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_...` | con prefijo VITE_, se expone al cliente (es pública) |
| `CLERK_SECRET_KEY` | `sk_test_...` | SIN prefijo VITE_, solo server-side |

> Importante: la `CLERK_SECRET_KEY` NUNCA debe llevar el prefijo `VITE_`, así no entra al bundle del cliente.

## 5. Hacerte admin (para ver el panel de usuarios)

El panel `/admin` solo aparece para usuarios con rol admin.

1. Iniciá sesión una vez en la app (o creá tu usuario en el dashboard).
2. Clerk dashboard → **Users** → tu usuario → pestaña **Metadata** → **Public**.
3. Pegá esto y guardá:

```json
{ "role": "admin" }
```

Con eso, al recargar la app vas a ver el botón **Admin** en el header.

## 6. Desplegar

```bash
cd v2
npm install        # instala @clerk/clerk-react y @clerk/backend
git add -A && git commit -m "feat: auth con Clerk + panel admin"
git push           # Vercel redeploya automaticamente
```

Verificá en https://asesor-inteligente-ia.vercel.app/ — debería pedirte login.

---

## Qué quedó implementado

- **App detrás del login**: nadie usa StockWise sin iniciar sesión (`src/App.jsx`).
- **Pantalla de login branded**: `src/auth/SignInScreen.jsx`.
- **Botón de usuario** (perfil / cerrar sesión) en el header.
- **Panel admin in-app** (`/admin`, hash route): tabla de usuarios con email, rol, registro y último ingreso. Visible solo para rol admin.
- **API protegida**: `api/admin/users.js` verifica el token de Clerk server-side y exige rol admin antes de devolver datos. Doble control: el frontend oculta el botón, el backend rechaza con 403.

## Para el Artefacto 3 (apartado 2.2 Ciberseguridad)

Esto te da material directo para documentar:
- **Autenticación y acceso**: Clerk (tokens de sesión JWT), control de acceso por rol (`publicMetadata.role`).
- **Protección de credenciales**: keys en variables de entorno (Vercel), nunca en el código. La secret key solo vive server-side.
- **Riesgo mitigado**: acceso no autorizado al panel admin → mitigado con verificación de token + chequeo de rol en el backend (no confía en el cliente).
