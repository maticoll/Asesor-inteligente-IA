# Asesor de Inversiones — MVP v2

Sistema multi-agente de análisis de inversiones que combina análisis técnico, fundamental y de riesgo con un orquestador LLM (Claude) para producir recomendaciones personalizadas.

> **Disclaimer:** Este sistema produce información para la toma de decisiones. No es asesoría financiera, no ejecuta órdenes y no garantiza rendimientos. Consultá a un profesional antes de invertir.

---

## Arquitectura

```
Ticker + Perfil
     │
     ▼
┌──────────────────────────────────────────┐
│  Promise.allSettled([                     │
│    Yahoo Finance → Agente Técnico         │  ← RSI, MACD, SMA50/200, régimen
│    Alpha Vantage → Agente Fundamental     │  ← P/E vs sector, ROE, PEG, EPS
│  ])                                       │
└────────────────┬─────────────────────────┘
                 │
                 ▼
         Agente de Riesgo                       ← VaR 95%, volatilidad, max peso
                 │
                 ▼
         Orquestador (Claude LLM)               ← Síntesis ponderada por horizonte
                 │
                 ▼
         Recomendación final
         buy / sell / hold + confianza
```

### Los 4 agentes

| Agente | Entrada | Salida | LLM |
|--------|---------|--------|-----|
| **Técnico** | OHLCV (Yahoo Finance) | señal, régimen, RSI/MACD/SMA | No |
| **Fundamental** | Overview (Alpha Vantage) | señal, valuación vs sector, quality | No |
| **Riesgo** | closes[] + beta + perfil | VaR 95%, ES, max_weight_pct | No |
| **Orquestador** | outputs de los 3 + perfil | recomendación final, justificación | Claude Sonnet |

### Lógica financiera

Toda la lógica de umbrales y reglas proviene de `INVESTIGACION_CRITERIOS_INVERSION.md`:
- **RSI**: filtro de tendencia (RSI-50) + disparadores por régimen (Constance Brown)
- **Régimen**: uptrend/downtrend/range detectado antes de aplicar señales
- **Regla crítica**: NO buy por RSI<30 en downtrend confirmado (E.1)
- **Fundamentales**: relativos al sector (medianas Damodaran), no absolutos
- **VaR**: paramétrico 95% (z=1.645), ES histórico (peor 5% de retornos)
- **Pesos por horizonte**: corto → técnico 60%; largo → fundamental 60%

---

## Setup local

### Requisitos

- Node.js 18+
- API key de [Alpha Vantage](https://www.alphavantage.co/support/#api-key) (gratuita)
- API key de [Anthropic](https://console.anthropic.com/) (Claude)

### Instalación

```bash
cd v2
npm install
```

### Variables de entorno

Crear `v2/.env.local`:

```env
# Solo para desarrollo local — en producción van en Vercel
ANTHROPIC_API_KEY=sk-ant-...
ALPHA_VANTAGE_API_KEY=tu_key_aqui
```

> En producción (Vercel) las keys van en el dashboard de Vercel, nunca en el código ni en el bundle del cliente.

### Desarrollo

```bash
npm run dev      # Levanta en localhost:3000
npm run test     # Ejecuta 68 tests unitarios + E2E
npm run build    # Build de producción
```

---

## Deploy en Vercel

1. Conectar el repo en [vercel.com](https://vercel.com)
2. Configurar el **Root Directory** como `v2/`
3. Agregar en **Environment Variables**:
   - `ANTHROPIC_API_KEY`
   - `ALPHA_VANTAGE_API_KEY`
4. Deploy automático en cada push a `master`

El archivo `vercel.json` ya está configurado con los rewrites y headers CORS necesarios.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite 8 + Tailwind 3 |
| Gráficos | Recharts |
| Tests | Vitest |
| APIs serverless | Vercel Functions (Node.js) |
| Datos de mercado | Yahoo Finance (OHLCV) |
| Datos fundamentales | Alpha Vantage (OVERVIEW) |
| Orquestador LLM | Claude Sonnet (Anthropic) |

---

## Limitaciones conocidas

- **Alpha Vantage free tier**: 25 requests/día. Si aparece error 429, esperá 1 minuto.
- **FCF yield y D/E**: no disponibles en el endpoint OVERVIEW de Alpha Vantage — se reportan como null. El análisis fundamental funciona con los campos disponibles.
- **Datos con retraso**: los datos de Yahoo Finance pueden tener hasta 15-20 min de retraso.
- **Tickers soportados**: principalmente NYSE/NASDAQ. Mercados internacionales pueden no tener cobertura completa en Alpha Vantage.
- **Recomendaciones**: son resultado de un modelo computacional. No sustituyen el análisis profesional ni consideran situación fiscal, patrimonio completo ni tolerancia real al riesgo.
