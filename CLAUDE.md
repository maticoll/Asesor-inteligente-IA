# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at localhost:3000 (opens browser automatically)
npm run build    # Production build
npm run preview  # Preview production build locally
```

No test runner is configured in this project.

## Architecture

Single-file React app (`InvestmentAdvisor.jsx`) with a Bloomberg terminal aesthetic. All logic lives in one file — no routing, no state management library.

### Multi-Agent Pipeline

Four agents run sequentially per analysis:

1. **Agent 1 – Technical** (`runTechnicalAgent`): Fetches 1-year OHLCV from Yahoo Finance via Vite proxy (`/api/yahoo`). Computes RSI(14), MACD(12,26,9), SMA50/200, volatility. Returns `signal + closes[]` (closes passed to Agent 3).
2. **Agent 2 – Fundamental** (`runFundamentalAgent`): Fetches company overview from Alpha Vantage via proxy (`/api/alpha`) or direct if `window.ENV.ALPHA_VANTAGE_API_KEY` is set. Scores P/E, ROE, PEG, FCF, EPS growth.
3. **Agent 3 – Risk** (`runRiskAgent`): Pure deterministic, no API call. Uses closes[] from Agent 1 and beta from Agent 2 to compute VaR(95%), annualized volatility, max portfolio weight.
4. **Agent 4 – Orchestrator** (`runOrchestratorAgent`): Calls `claude-sonnet-4-6` via `/api/claude` proxy (or directly if `window.ENV.ANTHROPIC_API_KEY` set). Weights agent signals by time horizon and returns structured JSON with `final_action`, `price_target`, `stop_loss`, `portfolio_weight`, `confidence_score`.

Agents 1 and 2 run in parallel (`Promise.allSettled`). Agent 3 runs after both. Agent 4 runs last.

### UI Structure

All panels are draggable, minimizable, and maximizable via `usePanels()` hook. Five panels with fixed IDs:
- `syscfg` — Investor profile (capital, risk profile, time horizon, sectors)
- `mktin` — Ticker input + agent status cards with progress bars
- `prcdat` — 60-day price chart (Recharts `AreaChart`)
- `anlytcs` — Technical/Fundamental/Risk metrics in 3-column monospace layout
- `sigout` — Final recommendation with `ConfidenceRing` SVG, price target, stop loss

### Design Tokens

All colors/fonts are defined in the `T` object at the top of `InvestmentAdvisor.jsx`. The palette is professional light mode (blue/white). Modify `T` to restyle globally.

### API Keys & Proxies

- **Dev**: Vite proxy in `vite.config.js` handles CORS for Yahoo Finance and Alpha Vantage.
- **Prod**: Requires a server-side proxy at `/api/claude` (Vercel recommended). API keys go in server env vars, not client.
- **Direct browser access**: Set `window.ENV = { ANTHROPIC_API_KEY, ALPHA_VANTAGE_API_KEY }` before React mounts to bypass proxies (dev/testing only — exposes keys).

The app requires `min-width: 900px`; renders `MobileFallback` below that threshold.
