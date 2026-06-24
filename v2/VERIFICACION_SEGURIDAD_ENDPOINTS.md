# Verificación — Seguridad de endpoints (StockWise)

> Prompt para ejecutar sobre el repo real (idealmente en Claude Code u otro agente que
> corra localmente, donde los archivos no estén "deshidratados" por OneDrive).
> Objetivo: confirmar que la autenticación de endpoints funciona. **No cambiar código**
> salvo que se encuentre un error. Reportar cada punto como **OK** o **FALLA**.

## Contexto

Se agregó autenticación con token de Clerk a los endpoints `/api/yahoo`, `/api/alpha` y
`/api/claude` (antes estaban abiertos), CORS restringido a una allowlist, y headers de
seguridad en `vercel.json`. El cliente (`InvestmentAdvisor.jsx` + `orchestrator.js`) ahora
envía el token de Clerk en cada llamada.

---

## 1. Build y lint

```bash
cd v2
npm install
npm run build    # debe compilar sin errores (confirma que todos los imports resuelven)
npm run lint     # reportar warnings/errores nuevos
npm test         # correr la suite; reportar si pasa
```

## 2. Revisión estática

Abrir los archivos y confirmar:

- **`api/_auth.js`** existe y exporta `requireAuth` (verifica el token con `CLERK_SECRET_KEY`
  y responde **401** si falta o es inválido) y `applyCors` (allowlist de orígenes, **no** `"*"`).
- **`api/yahoo.js`**, **`api/alpha.js`** y **`api/claude.js`**: cada uno llama `applyCors`,
  maneja `OPTIONS`, y llama `await requireAuth(req, res)` retornando si falla, **antes** de la lógica.
- **`src/InvestmentAdvisor.jsx`**: usa `useAuth()`; obtiene `const token = await getToken()`
  en `runAnalysis` y lo pasa a `fetchYahoo`, `fetchAlpha` y `runOrchestratorAgent`.
- **`src/agents/orchestrator.js`**: `callClaude` agrega el header `Authorization: Bearer <token>`.
- **`vercel.json`**: es JSON válido, **no** tiene `Access-Control-Allow-Origin: "*"`, e incluye
  `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`
  y `Permissions-Policy`.

## 3. Pruebas en vivo (después de `git push` y deploy en Vercel)

Confirmar primero que `CLERK_SECRET_KEY` y `VITE_CLERK_PUBLISHABLE_KEY` están en las
variables de entorno de Vercel.

**Sin token, deben dar 401:**

```bash
curl -i "https://asesor-inteligente-ia.vercel.app/api/yahoo?ticker=AAPL"
curl -i "https://asesor-inteligente-ia.vercel.app/api/alpha?ticker=AAPL"
curl -i -X POST "https://asesor-inteligente-ia.vercel.app/api/claude" \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"hola"}]}'
```

→ Los tres deben responder **401** (antes `/api/yahoo` devolvía datos).

**Headers de seguridad presentes:**

```bash
curl -I "https://asesor-inteligente-ia.vercel.app/"
```

→ debe incluir `x-frame-options: DENY` y `strict-transport-security`.

**Flujo logueado funciona:** entrar a la app, iniciar sesión, correr un análisis de un
ticker (ej. `AAPL`) → debe completar los 4 agentes y mostrar la recomendación (el token
viaja solo).

**CORS:** desde otro origen, una llamada al endpoint **no** debe traer
`Access-Control-Allow-Origin: "*"`.

## 4. Resultado

Listar **OK / FALLA** por punto. Si algo falla, indicar archivo, línea y el fix mínimo.

---

**Lo más importante:** los tres `curl` del punto 3. Si dan **401**, la mitigación quedó
real (y es buena prueba para la defensa).
