# Plan de Implementación — MVP

## Plataforma de Asesoría Inteligente de Inversiones

**Proyecto:** Sistema multi-agente de asesoría de inversiones para inversores minoristas
**Base:** Obligatorio 1 — Aplicaciones de IA a los negocios (Coll, Roibal, Kowalczyk)
**Enfoque de este plan:** MVP pragmático, implementación desde cero
**Fecha:** Junio 2026

---

## 1. Objetivo del MVP

Construir, de punta a punta, la versión mínima funcional de la plataforma descrita en el documento: un sistema multi-agente que recibe un activo (ticker) y el perfil de un inversor, ejecuta tres análisis especializados en paralelo (técnico, fundamental, riesgo), y un orquestador con LLM sintetiza una recomendación personalizada y justificada (comprar / vender / mantener) con score de confianza.

El MVP debe demostrar el valor central del documento — **síntesis automatizada de análisis fragmentados y contradictorios en una recomendación personalizada** — sin la complejidad de la visión completa (SLMs entrenados, 100 activos simultáneos, infra AWS para 1.000 usuarios). Esos puntos quedan en el roadmap post-MVP (sección 9).

### Criterio de éxito del MVP

Un usuario ingresa un ticker y su perfil, presiona "Analizar", y en menos de ~30 segundos obtiene una recomendación accionable con: acción sugerida, score de confianza, precio objetivo, stop loss, ponderación de cartera y una justificación multi-criterio en lenguaje natural que explica cómo se resolvieron las señales de cada agente.

---

## 2. Alcance del MVP

### Incluye (v1.0)

- Análisis **on-demand de un activo a la vez** (una acción por corrida).
- Tres agentes especializados: técnico, fundamental y riesgo.
- Un agente orquestador (LLM) que sintetiza y personaliza.
- Personalización por perfil del inversor: capital, tolerancia al riesgo, horizonte temporal, sectores preferidos.
- Recomendación con horizonte corto/medio/largo, precio objetivo, stop loss y ponderación de cartera sugerida.
- Justificación multi-criterio en lenguaje natural + desglose de señales por agente.
- Dashboard web interactivo (solo escritorio).
- Integración con APIs públicas gratuitas (Yahoo Finance, Alpha Vantage).

### Recorte pragmático respecto al documento

| Capacidad del documento | Decisión en el MVP | Por qué |
|---|---|---|
| Hasta 100 activos simultáneos | 1 activo por corrida (watchlist queda para post-MVP) | Reduce complejidad de estado, costo de API y rate limits. El valor se demuestra con un activo. |
| SLMs entrenados (técnico/fundamental) | Agentes **determinísticos** (indicadores calculados) | Entrenar y servir SLMs es un proyecto en sí mismo. Los cálculos clásicos (RSI, MACD, ratios) son suficientes y auditables para el MVP. |
| Orquestador con LLM | Se mantiene: LLM (Claude) para síntesis | Es el corazón del valor agéntico; no se recorta. |
| Auto-refresh cada 15-30 min | Manual (botón) en v1.0; auto-refresh opcional como flag | Evita consumo continuo de API y costo en la etapa de validación. |
| Infra AWS para 1.000 usuarios | Deploy serverless simple (Vercel) | El MVP valida el producto, no escala. La infra de escala va en el roadmap. |

### Queda explícitamente fuera (igual que el documento, más recortes del MVP)

- Ejecución automática de órdenes (solo recomendaciones).
- Análisis de opciones o derivados complejos.
- Predicción de precios exactos.
- App móvil (solo web).
- Multi-activo / watchlists, backtesting, autenticación de usuarios y persistencia de cartera (post-MVP).

---

## 3. Arquitectura técnica

### 3.1 Tipo de arquitectura

**Multi-agente con especialización funcional y orquestación jerárquica con supervisión**, tal como define el documento. Cada agente domina un dominio; el orquestador media entre señales potencialmente contradictorias y produce la síntesis final.

### 3.2 Estrategia de modelos (híbrida)

- **Agente técnico:** determinístico (cálculo de indicadores sobre precios históricos). Sin LLM.
- **Agente fundamental:** determinístico (scoring de ratios financieros contra umbrales/sector). Sin LLM.
- **Agente de riesgo:** determinístico cuantitativo (VaR, volatilidad, beta, ponderación). Sin LLM.
- **Orquestador:** LLM (Claude) para validar consistencia, asignar pesos según horizonte y generar justificación en lenguaje natural.

Esta separación mantiene el costo bajo (una sola llamada a LLM por análisis) y deja todo el cálculo numérico determinístico y auditable.

### 3.3 Stack propuesto

| Capa | Tecnología | Rol |
|---|---|---|
| Frontend | React + Vite | Dashboard interactivo, formulario de perfil, visualización |
| Gráficos | Recharts | Serie de precios y métricas |
| Backend (proxy) | Funciones serverless (Vercel) | Proteger API keys, evitar CORS, llamar a Claude/Alpha Vantage |
| Datos de mercado | Yahoo Finance (no oficial) | OHLCV histórico (precios) |
| Datos fundamentales | Alpha Vantage (free tier) | Ratios (P/E, ROE, etc.), beta |
| LLM | API de Anthropic (Claude) | Orquestador |
| Deploy | Vercel | Hosting + serverless |

> **Nota de seguridad:** las API keys nunca van en el cliente. Viven en variables de entorno del servidor y se acceden vía los endpoints `/api/*`.

### 3.4 Flujo general

```
T=0    Usuario ingresa ticker + perfil → presiona "Analizar"
T=0    Ingesta de datos (precios + fundamentales) vía proxies
        │
        ├─► Agente Técnico ──────┐  (en paralelo)
        ├─► Agente Fundamental ──┤
        │                        │
T~5s    └─► Agente de Riesgo ◄───┘  (usa salidas de técnico + fundamental + perfil)
        │
T~10s   Orquestador (Claude): valida consistencia, pondera por horizonte,
        detecta contradicciones, genera recomendación + justificación
        │
T~15s   Dashboard renderiza recomendación final
```

Los agentes técnico y fundamental corren en paralelo (`Promise.allSettled`). El de riesgo corre después (depende de sus salidas). El orquestador corre último. El sistema es tolerante a fallos: si un agente falla, el orquestador recibe el error y ajusta la confianza en consecuencia.

---

## 4. Definición de agentes

### Agente 1 — Análisis Técnico
- **Objetivo:** evaluar el momentum y la tendencia del precio.
- **Input:** serie de precios históricos (OHLCV, ~200 días) desde Yahoo Finance.
- **Cálculo:** RSI(14), MACD(12,26,9), SMA50/200, volatilidad, tendencia (cruce de medias).
- **Output:** `{ señal: buy|sell|hold, confianza: 0-100, justificación, indicadores }`.
- **Lógica:** reglas sobre indicadores (ej. RSI<30 + MACD alcista → sesgo compra). Pasa la serie de precios al agente de riesgo.

### Agente 2 — Análisis Fundamental
- **Objetivo:** evaluar la salud financiera y valuación de la empresa.
- **Input:** ratios financieros desde Alpha Vantage (P/E, ROE, PEG, FCF, crecimiento de EPS, beta).
- **Cálculo:** scoring de cada ratio contra umbrales razonables; valuación relativa.
- **Output:** `{ señal: buy|sell|hold, confianza: 0-100, valuación, quality_score }`.
- **Lógica:** scoring ponderado de ratios. Provee `beta` al agente de riesgo.

### Agente 3 — Gestión de Riesgo
- **Objetivo:** acotar la exposición según el perfil del inversor.
- **Input:** serie de precios (de Agente 1), beta (de Agente 2), perfil del inversor.
- **Cálculo:** VaR(95%), volatilidad anualizada, ponderación máxima recomendada en cartera.
- **Output:** `{ nivel_riesgo: alto|medio|bajo, ponderación_máx: float, var_95, justificación }`.
- **Lógica:** determinística pura, sin API ni LLM.

### Agente 4 — Orquestador
- **Objetivo:** sintetizar las tres señales en una recomendación personalizada.
- **Input:** las tres salidas de los agentes + perfil del inversor.
- **Herramienta:** API de Claude vía `/api/claude`.
- **Lógica:** valida consistencia entre señales, las pondera según el horizonte temporal (corto plazo → más peso al técnico; largo plazo → más peso al fundamental), detecta contradicciones, y genera la salida estructurada.
- **Output (JSON):** `{ final_action, price_target, stop_loss, portfolio_weight, confidence_score, horizonte, contradiction_detected, justification_multicriteria }`.

---

## 5. Fases de implementación

Cada fase es entregable e independientemente verificable. Estimaciones en jornadas de trabajo de un equipo de 2-3 personas; ajustar según disponibilidad.

### Fase 0 — Setup del proyecto (≈0.5 día)
- Inicializar repo: React + Vite + Tailwind, estructura de carpetas, `.gitignore`.
- Configurar variables de entorno (`.env.example`) y `vite.config.js` con proxy de dev.
- Deploy inicial vacío en Vercel para validar el pipeline.
- **Criterio de aceptación:** `npm run dev` levanta la app; deploy en Vercel responde.

### Fase 1 — Capa de datos y proxies (≈1.5 días)
- Endpoint `/api/yahoo` → OHLCV histórico.
- Endpoint `/api/alpha` → overview fundamental.
- Endpoint `/api/claude` → proxy a Anthropic (con API key en servidor).
- Manejo de errores, timeouts y rate limits; normalización de respuestas.
- **Criterio de aceptación:** los tres endpoints devuelven datos válidos para un ticker de prueba (ej. AAPL) y errores controlados para un ticker inválido.

### Fase 2 — Agentes determinísticos (≈2 días)
- Funciones de cálculo: RSI, MACD, SMA, volatilidad, VaR.
- `runTechnicalAgent`, `runFundamentalAgent`, `runRiskAgent` con sus contratos de I/O (sección 4).
- Tests unitarios de los cálculos contra valores conocidos.
- **Criterio de aceptación:** dados datos de mercado de prueba, cada agente devuelve su JSON con señal y confianza; los cálculos coinciden con valores de referencia.

### Fase 3 — Orquestador con LLM (≈1.5 días)
- Diseño del prompt del orquestador (rol, reglas de ponderación por horizonte, formato de salida JSON, manejo de errores de agentes).
- `runOrchestratorAgent`: arma el contexto, llama a Claude, parsea y valida el JSON.
- Lógica de detección de contradicciones y ajuste de confianza.
- **Criterio de aceptación:** dadas tres señales (incluyendo casos contradictorios), el orquestador devuelve una recomendación coherente y bien formada; degrada con elegancia si falta una señal.

### Fase 4 — Orquestación del pipeline (≈1 día)
- Coordinación: técnico + fundamental en paralelo → riesgo → orquestador.
- Manejo de estados por agente (idle/fetching/analyzing/ready/error) y tolerancia a fallos parciales.
- **Criterio de aceptación:** una corrida completa produce la recomendación final aunque un agente individual falle.

### Fase 5 — Dashboard / UI (≈2.5 días)
- Formulario de perfil del inversor (capital, riesgo, horizonte, sectores).
- Input de ticker + botón Analizar; indicadores de estado por agente.
- Panel de precio (gráfico Recharts) + panel de métricas (técnico/fundamental/riesgo).
- Panel de recomendación final: acción, anillo de confianza, precio objetivo, stop loss, ponderación, justificación.
- Fallback para pantallas chicas (solo escritorio en v1.0).
- **Criterio de aceptación:** flujo completo usable desde el navegador; estados de carga y error visibles; recomendación legible.

### Fase 6 — Pruebas, pulido y deploy (≈1.5 días)
- Pruebas end-to-end con varios tickers (alta/baja volatilidad, contradicciones).
- Manejo de edge cases (ticker inexistente, API caída, datos incompletos).
- Deploy productivo en Vercel con claves en variables de entorno.
- README con instrucciones de uso y limitaciones.
- **Criterio de aceptación:** la app productiva ejecuta análisis reales de punta a punta; las claves no quedan expuestas en el cliente.

**Estimación total:** ≈10-11 días de trabajo efectivo del equipo.

---

## 6. Datos y APIs

| Fuente | Uso | Plan | Límite relevante |
|---|---|---|---|
| Yahoo Finance | Precios históricos (OHLCV) | Gratuito (no oficial) | Sin SLA; usar con cuidado y cache corto |
| Alpha Vantage | Ratios fundamentales, beta | Free tier | ~25 requests/día (free); considerar key paga si se necesita más |
| Anthropic (Claude) | Orquestador | Pago por uso | Costo por tokens (ver sección 7) |

**Recomendación:** cachear respuestas de mercado por algunos minutos para no golpear las APIs en cada interacción y mantenerse dentro de los límites del free tier durante el desarrollo.

---

## 7. Costos del MVP

El documento estima ~$84.000/año para 1.000 usuarios en producción AWS. Eso es la *visión a escala*, no el MVP. Para la etapa de validación, el costo es marginal:

| Ítem | Costo estimado (MVP) |
|---|---|
| Hosting (Vercel Hobby/Pro) | $0 – $20 / mes |
| Yahoo Finance | $0 |
| Alpha Vantage | $0 (free tier) o ~$50/mes si se requiere mayor volumen |
| Claude (orquestador) | ~$0,01 – $0,05 por análisis (1 llamada de contexto acotado) |
| **Total mensual en validación** | **≈ $0 – $70 / mes** |

Con ~1.000 análisis/mes durante la validación, el costo de LLM ronda los $10-50 dólares. La estructura de costos a escala (infra, APIs pagas, mantenimiento) se aborda en el roadmap, no en el MVP.

**Relación costo/valor:** se mantiene el argumento del documento — para un portafolio promedio de $50.000, un ahorro o mejora del 2-5% anual ($1.000-2.500) supera ampliamente el costo de operación, dejando margen para un precio de suscripción de $10-20/mes en una etapa posterior.

---

## 8. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Yahoo Finance es API no oficial y puede romperse | Alto (sin datos de precio) | Abstraer la fuente detrás del endpoint `/api/yahoo`; tener un proveedor alternativo identificado |
| Rate limit de Alpha Vantage free | Medio | Cache de respuestas; key paga si escala el uso |
| El LLM devuelve JSON mal formado | Medio | Prompt con formato estricto + validación/parseo defensivo + reintento |
| Costo de LLM sube con el uso | Bajo en MVP | Contexto acotado, 1 llamada por análisis, monitoreo de tokens |
| Calidad de la recomendación percibida como "consejo financiero" | Legal/reputacional | Disclaimer claro: el sistema da información, no asesoría financiera; no ejecuta órdenes |
| Alcance se infla hacia la visión completa | Cronograma | Mantener el recorte de la sección 2; lo demás va al roadmap |

---

## 9. Roadmap post-MVP

Lo que el documento describe y queda fuera del MVP, priorizado para iteraciones siguientes:

1. **Multi-activo / watchlists:** analizar varios tickers y comparar (hacia los "100 activos" del documento).
2. **Auto-refresh** cada 15-30 min con notificación de cambio de señal.
3. **Persistencia y autenticación:** cuentas de usuario, perfiles guardados, historial de recomendaciones y cartera.
4. **SLMs especializados:** reemplazar los agentes determinísticos por modelos pequeños entrenados, como plantea el documento.
5. **Backtesting:** validar la calidad histórica de las recomendaciones.
6. **Infra de escala:** migración a una arquitectura tipo AWS para soportar ~1.000 usuarios, con el modelo de costos del documento.
7. **App móvil.**

---

## 10. Próximos pasos inmediatos

1. Confirmar stack y proveedor de deploy (este plan asume React/Vite + Vercel).
2. Conseguir las API keys (Alpha Vantage, Anthropic).
3. Arrancar la **Fase 0** y avanzar fase por fase, validando el criterio de aceptación de cada una antes de seguir.
