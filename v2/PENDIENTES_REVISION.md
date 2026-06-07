# Revisión del MVP (/v2) — Pendientes y mejoras

**Fecha de revisión:** 7 jun 2026
**Estado general:** el MVP está construido casi completo y **bien alineado** con `INVESTIGACION_CRITERIOS_INVERSION.md` y `PLAN_EJECUCION_CLAUDE_CODE.md`. Los agentes, proxies, pipeline y UI están implementados. Esta lista son ajustes pendientes, ordenados por prioridad.

---

## ¿Hace falta correr la app localmente?

**No.** El proyecto está configurado para **Vercel** (`vercel.json` + funciones serverless en `/api`). Flujo recomendado:

1. Subir `/v2` a un repo (GitHub).
2. Conectar el repo a Vercel.
3. Cargar las variables de entorno en Vercel: `ANTHROPIC_API_KEY` y `ALPHA_VANTAGE_API_KEY`.
4. Deploy → queda en una URL pública, sin correr nada en tu compu.

**`npm test` es opcional** — solo verifica la lógica de los agentes; no es necesario para que la app funcione. Si querés verificar sin usar tu máquina, se puede agregar un GitHub Action que corra `npm test` en cada push (ver P3 abajo). Para desarrollo local sí sirve `npm run dev` (levanta en `localhost:3000` con los proxies montados), pero no es obligatorio.

---

## PRIORIDAD ALTA — afectan la correctitud

### A1. La regla de apalancamiento (ROE + deuda) y el FCF están "muertos" con datos reales
- **Qué pasa:** `api/alpha.js` usa el endpoint `OVERVIEW` de Alpha Vantage, que **no trae** `debt_to_equity`, `fcf` ni `fcf_yield` → siempre se devuelven `null`.
- **Consecuencia:** en `fundamental.js`, la penalización por "ROE alto con D/E alto" (Parte B.2 / E.5 de la investigación, una de las reglas clave) **nunca se dispara** con datos reales, y el score de FCF nunca contribuye. La lógica está bien escrita, pero le llega `null`.
- **Opciones:**
  - (a) Traer `debt_to_equity` y FCF con llamadas extra a Alpha Vantage (`BALANCE_SHEET` y `CASH_FLOW`). **Costo:** pasa de 1 a 3 requests por análisis → con el free tier (~25/día) son ~8 análisis/día. Cachear ayuda.
  - (b) Dejarlo documentado como limitación conocida del MVP y mostrar "N/D" en la UI para esas métricas.
- **Recomendación:** para la entrega, opción (b) + nota en el README; si se quiere robustez real, opción (a) con cache.

### A2. El orquestador manda toda la serie de precios al LLM (costo y tokens)
- **Qué pasa:** en `orchestrator.js`, `buildUserMessage` hace `JSON.stringify(techResult)`, y `techResult` incluye el array `closes[]` completo (~250 números) en cada llamada.
- **Consecuencia:** infla los tokens de entrada en cada análisis → más costo y más lento, sin aportar nada (el LLM no necesita los 250 cierres).
- **Fix:** antes de mandar al LLM, quitar `closes` del objeto técnico (ej. `const { closes, ...techForLLM } = techResult`). Barato y de impacto directo en el costo.

### A3. El orquestador no recibe el precio actual
- **Qué pasa:** el LLM debe devolver `price_target` y `stop_loss`, pero en el contexto no se le pasa `currentPrice` de forma explícita (queda implícito en `closes`, que además conviene sacar por A2).
- **Consecuencia:** los `price_target`/`stop_loss` salen como estimaciones poco ancladas al precio real.
- **Fix:** pasar `currentPrice` (de `yahooData`) explícitamente en el mensaje del orquestador, y mencionarlo en el prompt para que ancle objetivos y stops a ese valor + la volatilidad.

---

## PRIORIDAD MEDIA — fidelidad a la investigación

### M1. El "cruce" de MACD no detecta el cruce, detecta el estado
- **Qué pasa:** en `technical.js`, `macdCrossUp = macd.hist > 0 && macd.line > macd.signal` describe que el MACD **está** por encima de la señal, no que **acaba de cruzar**. No hay comparación contra la barra anterior.
- **Consecuencia:** menor precisión en el disparador de cruce; funciona como filtro de estado, no como señal de evento.
- **Fix:** calcular la serie de histograma y detectar cambio de signo entre las dos últimas barras (cruce real). Requiere exponer la serie MACD desde `indicators.js`.

### M2. Soportes/resistencias no están implementados
- **Qué pasa:** la investigación (Parte A.5) cubre soportes/resistencias y confirmación por volumen, pero el agente técnico no los calcula. El contrato del plan no los exigía estrictamente, así que no es un incumplimiento, pero es una mejora natural (el MVP viejo en la raíz sí tenía lógica de resistencia de 52 semanas).
- **Fix opcional:** agregar detección simple de soporte/resistencia (máx/mín de N días) y usar el volumen para confirmar breakouts.

### M3. `eps_growth` es crecimiento trimestral YoY, no anual
- **Qué pasa:** `api/alpha.js` mapea `QuarterlyEarningsGrowthYOY` a `eps_growth`. La investigación (B.5) habla de crecimiento **anual** 10–15%.
- **Consecuencia:** los umbrales de `scoreEPS` se aplican sobre una métrica trimestral; es un proxy razonable pero no idéntico.
- **Fix:** documentarlo, o traer crecimiento anual de EPS si se agregan más llamadas a Alpha Vantage.

---

## PRIORIDAD BAJA — config y verificación

### P1. Modelo del orquestador hardcodeado como placeholder
- `claude-sonnet-4-6` aparece en **dos lugares**: `api/claude.js` (`DEFAULT_MODEL`) y `orchestrator.js` (ruta directa con `window.ENV`). Confirmar el modelo vigente y actualizarlo en ambos. Si se quiere mejor síntesis, evaluar un modelo más capaz.

### P2. Variables de entorno
- Confirmar que el `.env` (local) y las env vars de Vercel tengan `ANTHROPIC_API_KEY` y `ALPHA_VANTAGE_API_KEY`. Sin la de Alpha, el fundamental devuelve error 500; sin la de Anthropic, el orquestador cae al fallback "hold".

### P3. Tests no verificados en este entorno
- La suite (`npm test`) no pudo correrse en la revisión por un binding nativo de Linux faltante (el `node_modules` se instaló en Windows) — es un problema de entorno, no del código. **Acción:** correr `npm test` en tu máquina, o agregar un GitHub Action que lo corra automáticamente en cada push. Verificación manual hecha: las reglas críticas (no-buy en downtrend, sector-relativo, trampa de apalancamiento con datos cargados a mano, escalado de riesgo, VaR) pasaron.

### P4. Verificación end-to-end con datos reales
- Con las keys cargadas, probar en la app real varios tickers: large-cap estable (AAPL), alta volatilidad (TSLA), un banco (value), y un ticker inválido. Confirmar que las recomendaciones son coherentes y que los estados de error se muestran bien.

### P5. Limpieza menor
- `vercel.json` tiene un rewrite `/api/yahoo/:path*` que no se usa (el cliente llama `/api/yahoo?ticker=`). Se puede quitar.
- `index.html` tiene `<title>v2</title>` — cambiar por un título real de la app.

---

## Resumen de qué tocar primero

1. **A2 + A3** (quitar `closes` del prompt y pasar `currentPrice`) — rápido, baja costo y mejora la calidad de los targets. *(15 min)*
2. **A1** — decidir entre traer deuda/FCF de Alpha Vantage o documentar la limitación. *(decisión de producto)*
3. **P1 + P2** — confirmar modelo y keys antes de desplegar. *(5 min)*
4. **P3 + P4** — correr tests y prueba end-to-end. *(verificación)*
5. **M1, M2, M3** — mejoras de fidelidad, no bloqueantes para la entrega.

> Nada de esto rompe el MVP: la arquitectura, los contratos y las reglas centrales están bien. A1 es el más importante en cuanto a fidelidad a la investigación; A2/A3 son los de mejor relación esfuerzo/impacto.
