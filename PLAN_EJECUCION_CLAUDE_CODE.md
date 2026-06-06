# Plan de Ejecución — MVP Plataforma de Asesoría de Inversiones

> **Para Claude Code:** este es un plan táctico ejecutable. Implementar **fase por fase, tarea por tarea**. Cada tarea tiene archivos, pasos y un **criterio de verificación** que debe cumplirse antes de avanzar. Hacer un commit por tarea. No saltear la verificación.
>
> Documentos de referencia (leer antes de empezar):
> - `PLAN_IMPLEMENTACION_MVP.md` — el "qué" y el "por qué" (alcance, arquitectura, fases).
> - `INVESTIGACION_CRITERIOS_INVERSION.md` — las reglas de decisión de cada agente (umbrales, lógica, fuentes). **Es la fuente de verdad para toda la lógica financiera.**

---

## 0. Convenciones y stack

- **Stack:** React 18 + Vite, Tailwind (solo spacing), Recharts, funciones serverless en `/api` (deploy Vercel).
- **Idioma del código:** inglés para identificadores; comentarios en español permitidos.
- **API keys:** SIEMPRE server-side (en `/api/*`), nunca en el cliente. Para dev se permite `window.ENV` solo como bypass documentado.
- **Sin runner de tests configurado aún** → Fase 2 agrega Vitest para los cálculos. Verificación visual con `npm run dev` para la UI.
- **Convención de commits:** `feat(faseN): ...`, `fix: ...`, `test: ...`.

### Estructura de archivos objetivo

```
/
├── api/
│   ├── yahoo.js          # proxy precios (OHLCV)
│   ├── alpha.js          # proxy fundamentales
│   └── claude.js         # proxy orquestador (Anthropic)
├── src/
│   ├── main.jsx
│   ├── index.css
│   ├── lib/
│   │   ├── indicators.js # cálculos puros: RSI, MACD, SMA, vol, VaR
│   │   ├── regime.js     # clasificador de régimen (tendencia/rango)
│   │   └── sectors.js    # medianas fundamentales por sector (ancla Damodaran)
│   ├── agents/
│   │   ├── technical.js     # runTechnicalAgent
│   │   ├── fundamental.js   # runFundamentalAgent
│   │   ├── risk.js          # runRiskAgent
│   │   └── orchestrator.js  # runOrchestratorAgent (prompt + parseo)
│   ├── components/       # UI (paneles, gráfico, formulario)
│   └── InvestmentAdvisor.jsx  # componente raíz que cablea todo
├── index.html
├── vite.config.js
├── package.json
└── .env.example
```

---

## Contratos de datos (la "API interna")

Estos shapes son el contrato entre capas. Respetarlos exactamente.

### Salida de `/api/yahoo` (normalizada)
```json
{
  "ticker": "AAPL",
  "currency": "USD",
  "closes": [171.2, 172.0, 169.8, "... ~250 cierres diarios, orden cronológico ..."],
  "highs":  [],
  "lows":   [],
  "volumes":[],
  "dates":  ["2025-06-10", "..."],
  "currentPrice": 195.3
}
```

### Salida de `/api/alpha` (normalizada)
```json
{
  "ticker": "AAPL",
  "sector": "Technology",
  "pe_trailing": 31.2,
  "pe_forward": 27.8,
  "roe": 0.147,            // fracción (0.147 = 14.7%)
  "peg": 2.1,
  "eps_growth": 0.08,      // YoY, fracción
  "fcf": 99000000000,      // USD, puede ser null
  "fcf_yield": 0.034,      // fracción, puede ser null
  "debt_to_equity": 1.5,
  "beta": 1.29,
  "market_cap": 3000000000000
}
```

### Contrato del Agente Técnico (`runTechnicalAgent`)
```json
{
  "signal": "buy | sell | hold",
  "score": 0.42,            // sub-score normalizado -1..+1
  "confidence": 0-100,
  "regime": "uptrend | downtrend | range",
  "indicators": {
    "rsi": 38.4,
    "macd": { "line": 1.2, "signal": 0.9, "hist": 0.3, "above_zero": true },
    "sma50": 188.1, "sma200": 175.4, "golden_cross": true,
    "price_vs_sma200": "above",
    "volatility_annual": 0.27
  },
  "justification": "texto breve en español",
  "closes": []              // se pasa al agente de riesgo
}
```

### Contrato del Agente Fundamental (`runFundamentalAgent`)
```json
{
  "signal": "buy | sell | hold",
  "score": -0.15,           // -1..+1
  "confidence": 0-100,
  "valuation": "cheap | fair | expensive",
  "quality_score": 0-100,
  "metrics_vs_sector": {
    "pe": { "value": 31.2, "sector_median": 34, "verdict": "fair" },
    "roe": { "value": 0.147, "verdict": "acceptable" },
    "peg": { "value": 2.1, "verdict": "expensive" }
  },
  "beta": 1.29,             // se pasa al agente de riesgo
  "justification": "texto breve en español"
}
```

### Contrato del Agente de Riesgo (`runRiskAgent`)
```json
{
  "risk_level": "low | medium | high",
  "score": -0.3,            // -1..+1 (negativo = más riesgo penaliza)
  "volatility_annual": 0.27,
  "var_95_pct": 0.022,      // VaR diario como fracción del valor de la posición
  "var_95_usd": 1100,       // sobre el capital asignado tentativo
  "es_95_pct": 0.031,       // Expected Shortfall (si hay closes)
  "beta": 1.29,
  "max_weight_pct": 7.0,    // % máximo recomendado en cartera
  "justification": "texto breve en español"
}
```

### Contrato del Orquestador (`runOrchestratorAgent`)
```json
{
  "final_action": "buy | sell | hold",
  "confidence_score": 0-100,
  "horizon": "short | medium | long",
  "price_target": 210.5,
  "stop_loss": 182.0,
  "portfolio_weight": 5.0,        // %
  "contradiction_detected": false,
  "agent_weights": { "technical": 0.4, "fundamental": 0.35, "risk": 0.25 },
  "justification_multicriteria": "texto en español explicando la síntesis"
}
```

---

## FASE 0 — Setup (≈0.5 día)

### Tarea 0.1 — Inicializar proyecto
- Crear estructura de carpetas de arriba. `npm create vite@latest` (React), instalar `recharts`, configurar Tailwind y `vite.config.js` con proxy de dev para `/api/yahoo` y `/api/alpha`.
- Crear `.env.example` con `ANTHROPIC_API_KEY=`, `ALPHA_VANTAGE_API_KEY=`.
- **Verificación:** `npm run dev` levanta sin errores en `localhost:3000`.
- **Commit:** `feat(fase0): scaffold proyecto vite + tailwind + estructura`.

### Tarea 0.2 — Deploy pipeline
- Configurar `vercel.json`; deploy inicial (puede estar vacío).
- **Verificación:** la URL de Vercel responde 200.
- **Commit:** `feat(fase0): deploy inicial vercel`.

---

## FASE 1 — Capa de datos y proxies (≈1.5 días)

### Tarea 1.1 — `/api/yahoo.js`
- Fetch de OHLCV (~1 año) desde Yahoo Finance; normalizar al contrato de `/api/yahoo`.
- Manejo de errores: ticker inválido → `{ error: "ticker not found" }` con status 404; timeout 8s.
- **Verificación:** `curl /api/yahoo?ticker=AAPL` devuelve ~250 closes; ticker basura devuelve error controlado.
- **Commit:** `feat(fase1): proxy yahoo OHLCV normalizado`.

### Tarea 1.2 — `/api/alpha.js`
- Fetch del company overview de Alpha Vantage; mapear al contrato de `/api/alpha` (convertir % a fracción, parsear nulls). Incluir `sector`.
- **Verificación:** `curl /api/alpha?ticker=AAPL` devuelve P/E, ROE, beta y sector no nulos.
- **Commit:** `feat(fase1): proxy alpha vantage fundamentales`.

### Tarea 1.3 — `/api/claude.js`
- Proxy a la API de Anthropic. API key desde env. Recibe `{ system, messages }`, reenvía, devuelve la respuesta. Modelo: `claude-sonnet-4-6` (o el vigente).
- **Verificación:** un POST de prueba devuelve texto del modelo.
- **Commit:** `feat(fase1): proxy claude orquestador`.

---

## FASE 2 — Cálculos puros + agentes determinísticos (≈2.5 días)

> Toda la lógica de esta fase sale de `INVESTIGACION_CRITERIOS_INVERSION.md`. Citar la sección correspondiente en comentarios.

### Tarea 2.1 — `src/lib/indicators.js` (funciones puras)
Implementar y exportar: `calcRSI(closes, 14)`, `calcMACD(closes, 12, 26, 9)`, `calcSMA(closes, n)`, `calcVolatilityAnnual(closes)` (= σ diaria × √252), `calcVaR95(value, dailySigma)` (= value × 1.645 × σ), `calcES95(closes)` (percentil 5 histórico / promedio de la cola).
- **Verificación (Vitest):** agregar Vitest. Tests contra valores conocidos: RSI de una serie de referencia, SMA de `[1..10]`, anualización (σ diaria 0.01 → ~0.1587). Todos en verde.
- **Commit:** `test(fase2): indicators puros con tests unitarios`.

### Tarea 2.2 — `src/lib/regime.js` (clasificador de régimen)
- `classifyRegime({ closes, sma50, sma200 })` → `"uptrend" | "downtrend" | "range"`. Regla: uptrend si precio > SMA200 y SMA50 > SMA200 y pendiente SMA50 ≥ 0; downtrend simétrico; si no, range. (Ref. Parte A.1 / E.1)
- **Verificación (Vitest):** series sintéticas alcista/bajista/lateral devuelven el régimen correcto.
- **Commit:** `feat(fase2): clasificador de régimen de mercado`.

### Tarea 2.3 — `src/lib/sectors.js`
- Tabla de medianas por sector (P/E, PEG) anclada en Damodaran (Parte B). Función `sectorMedian(sector, metric)` con fallback al promedio de mercado si el sector no está.
- **Verificación:** `sectorMedian("Technology","pe")` y un sector inexistente (usa fallback) devuelven números.
- **Commit:** `feat(fase2): medianas fundamentales por sector`.

### Tarea 2.4 — `src/agents/technical.js`
Implementar `runTechnicalAgent(yahooData, onStatus)` según contrato. Lógica (Parte A + E):
1. Calcular RSI, MACD, SMA50/200, volatilidad. Clasificar régimen.
2. **Filtros primero:** RSI-50 y signo de MACD definen sesgo direccional.
3. **Disparadores según régimen:**
   - En **range**: RSI<30 → +; RSI>70 → −. Cruce de señal MACD en la dirección del filtro.
   - En **uptrend**: RSI dip a ~40–50 → + (comprar corrección); no shortear en 70. Golden Cross refuerza +.
   - En **downtrend**: RSI rebote a ~50–60 → −; Death Cross refuerza −.
4. Combinar en `score` normalizado (−1..+1), derivar `signal` y `confidence` (más confianza si filtros y disparadores coinciden y el régimen es claro).
- **Verificación (Vitest):** casos sintéticos — sobreventa en rango → buy; tendencia alcista sana → buy/hold con score>0; tendencia bajista → sell. Que nunca dé buy por RSI<30 dentro de un downtrend confirmado.
- **Commit:** `feat(fase2): agente técnico con reglas por régimen`.

### Tarea 2.5 — `src/agents/fundamental.js`
Implementar `runFundamentalAgent(alphaData, onStatus)` según contrato. Lógica (Parte B + E):
1. Comparar P/E, PEG **contra la mediana del sector** (`sectors.js`), no contra cortes absolutos.
2. ROE: bueno >15% (penalizar si `debt_to_equity` alto). PEG <1 barato / ~1 justo / >1 caro. FCF yield bueno >7–8% (rate-aware si se tiene la tasa; si no, umbral fijo documentado). EPS growth 10–15% sano.
3. Componer `quality_score`, `valuation` y `score` normalizado; derivar `signal` y `confidence`. Si faltan datos clave (earnings negativos, P/E indefinido), bajar confianza y tender a hold.
- **Verificación (Vitest):** empresa value barata y rentable → buy; empresa cara con PEG>2 → sell/caution; empresa con ROE alto pero D/E alto → no premiar como calidad alta.
- **Commit:** `feat(fase2): agente fundamental relativo al sector`.

### Tarea 2.6 — `src/agents/risk.js`
Implementar `runRiskAgent(techResult, fundResult, profile, onStatus)` (determinístico, sin API). Lógica (Parte C + E):
1. Volatilidad anualizada (de `closes`), beta (de fundamental). VaR95 paramétrico + ES95 histórico.
2. `risk_level`: vol <15% low, 15–30% medium, >30% high.
3. `max_weight_pct`: base por perfil (conservador 5 / moderado 7–10 / agresivo 10–15), **escalado hacia abajo por beta y volatilidad**.
- **Verificación (Vitest):** baja vol + beta<1 → low risk, peso mayor; alta vol + beta>1.5 → high risk, peso recortado. VaR coincide con `value×1.645×σ`.
- **Commit:** `feat(fase2): agente de riesgo VaR + ponderación por perfil`.

---

## FASE 3 — Orquestador con LLM (≈1.5 días)

### Tarea 3.1 — Prompt del orquestador
Crear el system prompt en `src/agents/orchestrator.js`. Debe incluir:
- **Rol:** sintetizar 3 análisis en una recomendación personalizada; el sistema da información, no asesoría financiera; no ejecuta órdenes.
- **Reglas de ponderación por horizonte** (Parte D.3): corto → técnico ~60/fund ~15/riesgo ~25; medio → 40/35/25; largo → 15/60/25.
- **Veto fundamental** a largo plazo: si el fundamental es claramente negativo, topear `final_action` en hold/avoid aunque el técnico sea buy (prior fuerte, no candado absoluto).
- **Confirmación:** exigir ≥2 señales de familias distintas alineadas para una acción ≠ hold; conflicto → bajar confianza o hold.
- **HOLD de primera clase**; bajar confianza si el régimen es ambiguo o hay contradicción.
- **Formato de salida:** JSON ESTRICTO con el contrato del orquestador, sin texto fuera del JSON.

Borrador del system prompt (ajustable):
```
Eres el orquestador de un sistema de asesoría de inversiones. Recibes 3 análisis
(técnico, fundamental, riesgo) y el perfil del inversor. Tu tarea: sintetizar una
recomendación personalizada y justificada. NO das asesoría financiera y NO ejecutas
órdenes; produces información para la decisión del usuario.

Pondera las señales según el horizonte del inversor:
- corto: técnico 0.60, fundamental 0.15, riesgo 0.25
- medio: técnico 0.40, fundamental 0.35, riesgo 0.25
- largo: técnico 0.15, fundamental 0.60, riesgo 0.25

Reglas:
- Si el fundamental es claramente negativo y el horizonte es largo, no recomiendes buy
  (máximo hold), salvo que el técnico muestre un cambio muy fuerte; explícalo.
- Exige al menos 2 señales alineadas de familias distintas para buy o sell; si están
  en conflicto, baja la confianza o recomienda hold.
- Respeta max_weight_pct del agente de riesgo como techo de portfolio_weight.
- stop_loss y price_target coherentes con la volatilidad y soportes/resistencias.
- Devuelve SOLO un JSON válido con: final_action, confidence_score, horizon,
  price_target, stop_loss, portfolio_weight, contradiction_detected, agent_weights,
  justification_multicriteria (en español).
```
- **Verificación:** revisar el prompt contra las reglas de la Parte D del informe.
- **Commit:** `feat(fase3): system prompt del orquestador`.

### Tarea 3.2 — `runOrchestratorAgent`
- Arma el contexto (3 resultados + perfil), llama a `/api/claude`, parsea y **valida el JSON** (parseo defensivo + 1 reintento si viene mal formado). Si un agente trae error, lo informa al prompt y ajusta confianza.
- Aplicar `portfolio_weight = min(LLM, risk.max_weight_pct)` como guardarraíl duro en código (no confiar solo en el LLM).
- **Verificación (Vitest con mock de `/api/claude`):** 3 señales alineadas → acción coherente y bien formada; caso contradictorio (técnico buy / fundamental sell a largo plazo) → hold o confianza baja; falta un agente → degrada con elegancia.
- **Commit:** `feat(fase3): runOrchestratorAgent con validación y guardarraíles`.

---

## FASE 4 — Pipeline (≈1 día)

### Tarea 4.1 — Orquestación del flujo
- En `InvestmentAdvisor.jsx`: técnico + fundamental en paralelo (`Promise.allSettled`) → riesgo (usa sus salidas + perfil) → orquestador. Estados por agente: `idle/fetching/analyzing/ready/error`. Tolerancia a fallos parciales.
- **Verificación:** una corrida completa produce recomendación final aunque el agente fundamental falle (ej. ticker sin datos de Alpha Vantage).
- **Commit:** `feat(fase4): pipeline multi-agente con tolerancia a fallos`.

---

## FASE 5 — Dashboard / UI (≈2.5 días)

### Tarea 5.1 — Formulario de perfil + input de ticker
- Capital, perfil de riesgo (conservador/moderado/agresivo), horizonte (corto/medio/largo), sectores. Input de ticker + botón Analizar. Estados de carga por agente.
- **Verificación:** se puede completar el perfil, ingresar ticker y disparar análisis; estados visibles.
- **Commit:** `feat(fase5): formulario de perfil + input`.

### Tarea 5.2 — Panel de precio + panel de métricas
- Gráfico de precio (Recharts, ~60–250 días). Panel de métricas en 3 columnas: técnico / fundamental / riesgo con los indicadores del contrato.
- **Verificación:** tras un análisis, el gráfico y las métricas se pueblan con datos reales.
- **Commit:** `feat(fase5): panel de precio y métricas`.

### Tarea 5.3 — Panel de recomendación final
- Acción (buy/sell/hold con color), anillo de confianza, precio objetivo, stop loss, ponderación, badge de contradicción, y la justificación multi-criterio + desglose por agente. Mostrar disclaimer ("información, no asesoría financiera").
- **Verificación:** la recomendación se renderiza completa y legible; el disclaimer está visible.
- **Commit:** `feat(fase5): panel de recomendación final`.

### Tarea 5.4 — Fallback escritorio
- `MobileFallback` para anchos < 900px.
- **Verificación:** en viewport 375px se muestra el mensaje de "requiere escritorio".
- **Commit:** `feat(fase5): fallback mobile`.

---

## FASE 6 — Pruebas, pulido y deploy (≈1.5 días)

### Tarea 6.1 — E2E manual con varios tickers
- Probar: large-cap estable (AAPL), alta volatilidad (TSLA), value (banco), ticker inválido. Verificar coherencia de la recomendación con los datos.
- **Verificación:** las 4 corridas terminan sin romper; las señales son razonables y explicables.
- **Commit:** `test(fase6): pruebas e2e manuales`.

### Tarea 6.2 — Edge cases y robustez
- Ticker inexistente, API caída, earnings negativos (P/E indefinido), datos faltantes. Mensajes de error claros, sin crashes.
- **Verificación:** ningún caso rompe la app; siempre hay feedback al usuario.
- **Commit:** `fix(fase6): manejo de edge cases`.

### Tarea 6.3 — Deploy productivo + README
- Deploy en Vercel con keys en env vars. README con uso, limitaciones y disclaimer.
- **Verificación:** la app productiva ejecuta un análisis real end-to-end; las keys NO aparecen en el bundle del cliente (revisar Network/sources).
- **Commit:** `feat(fase6): deploy productivo + README`.

---

## Checklist de aceptación del MVP

- [ ] Un análisis completo (ticker + perfil) produce recomendación en < ~30s.
- [ ] Los agentes respetan las reglas del informe (régimen, sector-relativo, VaR, ponderación por horizonte).
- [ ] El orquestador devuelve JSON válido, aplica veto fundamental y guardarraíl de `portfolio_weight`.
- [ ] HOLD aparece cuando hay contradicción o baja confirmación.
- [ ] Tests de `indicators.js`, agentes y orquestador (mock) en verde.
- [ ] API keys server-side; no expuestas en el cliente.
- [ ] Disclaimer visible: información, no asesoría financiera; no ejecuta órdenes.

## Orden de entrega a Claude Code

Pasar **una fase por vez** (Fase 0 → 6), validando el checklist de cada tarea antes de seguir. Las Fases 0–1 (setup/datos) y 2–3 (lógica) son las de mayor riesgo; revisarlas con más cuidado. La lógica financiera siempre se valida contra `INVESTIGACION_CRITERIOS_INVERSION.md`.
