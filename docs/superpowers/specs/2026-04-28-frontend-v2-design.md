# Frontend v2.0 Design Spec — AI Investment Terminal

**Date:** 2026-04-28  
**Project:** AI Investment Advisor (InvestmentAdvisor.jsx)  
**Status:** Approved

---

## Overview

Redesign the frontend from a static sidebar+panel layout to a Bloomberg-style financial terminal with draggable panels, green-on-black monospace aesthetic, and richer data visualization. All logic remains in the single `InvestmentAdvisor.jsx` file. No new dependencies beyond existing React, Recharts, and Tailwind.

---

## 1. Visual Design System

### Color Palette

| Token | Hex | Usage |
|---|---|---|
| `bg-terminal` | `#000000` | Page background |
| `green-primary` | `#00ff41` | Main text, active borders, highlights |
| `green-mid` | `#00cc33` | Secondary metrics, labels |
| `green-dark` | `#003311` | Panel borders at rest |
| `green-glow` | `#00ff4120` | box-shadow on panels |
| `bg-panel` | `#050f05` | Panel background |
| `bg-panel-header` | `#001a00` | Panel title bar |
| `red-terminal` | `#ff3333` | SELL signal, errors |
| `yellow-terminal` | `#ffcc00` | HOLD signal, warnings |

### Typography
- **Font family:** `'Courier New', Courier, monospace` — applied globally to the component
- **Numbers:** right-aligned, consistent size, monospace ensures column alignment
- **Labels:** UPPERCASE, letter-spacing: 0.1em
- **No Google Fonts or external font imports**

### Terminal Effects
- **Scanlines:** `repeating-linear-gradient(transparent 0px, transparent 3px, rgba(0,255,65,0.03) 3px, rgba(0,255,65,0.03) 4px)` as a fixed overlay on `::before` pseudo-element (or via inline `backgroundImage` on a wrapper div)
- **Panel glow:** `box-shadow: 0 0 12px #00ff4120, 0 0 1px #00ff4140`
- **Cursor blink:** CSS keyframe `blink` on ticker input caret (`caretColor: '#00ff41'`)
- **Analyzing animation:** `>>> ANALIZANDO.` → `>>> ANALIZANDO..` → `>>> ANALIZANDO...` cycling via `useEffect` interval

### Agent Status Badges
Replace dot indicators with bracketed monospace badges:

| State | Badge | Color |
|---|---|---|
| idle | `[IDLE ]` | `#003311` |
| waiting | `[WAIT ]` | `#006622` |
| fetching | `[FETCH]` | `#00ff41` (pulse) |
| analyzing | `[ANLZ.]` | `#00ff41` (pulse) |
| ready | `[READY]` | `#00ff41` |
| error | `[ERR! ]` | `#ff3333` |

---

## 2. Panel Architecture

### Panel State Shape
```javascript
{
  id: string,
  x: number,       // left position in px
  y: number,       // top position in px
  zIndex: number,  // stacking order (increases on click)
  minimized: boolean,
  maximized: boolean,
}
```

### Default Panel Layout (1280px viewport reference)
```
[SYS.CFG]  340×380px   left:20    top:80
[MKT.IN]   380×400px   left:380   top:80
[PRC.DAT]  400×300px   left:780   top:80
[ANLYTCS]  560×320px   left:20    top:480
[SIG.OUT]  600×460px   left:600   top:400
```

### The 5 Panels

#### `[SYS.CFG]` — INVESTOR PROFILE
Config inputs in terminal style:
- Capital: text input right-aligned, `$ 50,000.00` formatted
- Risk profile: custom styled `<select>` with green border
- Time horizon: `<select>`
- Preferred sectors: comma-separated text input
- Auto-refresh toggle: ASCII-styled `[OFF] ──● [ON]`

#### `[MKT.IN]` — MARKET INPUT
- Ticker input with `>` prompt prefix and blinking cursor
- `[ANALYZE ▶]` button — green border, black bg, hover fills green
- 4 agent rows, each showing: name, status badge, ASCII progress bar, signal badge (when ready)
- ASCII progress bar: `████████░░` — 10 chars, fills proportionally to status stage

#### `[PRC.DAT]` — PRICE DATA
- Ticker + current price large, % change with ▲/▼ arrow
- Recharts `LineChart` with:
  - stroke `#00ff41`, strokeWidth 1.5
  - No axes except minimal X dates
  - Custom green tooltip
  - No grid lines (or very subtle `#001a00` lines)
  - Fill area below line with gradient `#00ff4108` → transparent

#### `[ANLYTCS]` — ANALYTICS
Three equal columns:
- **TECHNICAL:** RSI(14), SMA50, SMA200, MACD, trend direction
- **FUNDAMENTAL:** P/E, ROE, PEG, Quality Score /100, Valuation label
- **RISK:** Risk level, Volatility 30d, VaR 95%, Beta, Max weight

All values right-aligned with `....` dot leaders between label and value.

#### `[SIG.OUT]` — SIGNAL OUTPUT
- Final action: large bracketed badge `▓▓▓ BUY ▓▓▓` / `▓▓▓ SELL ▓▓▓` / `▓▓▓ HOLD ▓▓▓`
- SVG confidence ring with green stroke, value centered
- Price target and stop loss with % delta from current price
- Portfolio allocation: `8.0% = $4,000.00`
- Contradiction flag if detected
- Multicriteria justification in a `>` prefixed text block
- Per-agent signal breakdown (collapsible rows)

---

## 3. Drag System

### Implementation
```javascript
// Custom hook
function usePanels(initialPositions) {
  const [panels, setPanels] = useState(initialPositions);
  const [dragging, setDragging] = useState(null); // { id, startX, startY, origX, origY }
  const maxZ = useRef(10);

  const onMouseDown = (id, e) => {
    if (e.target.closest('[data-no-drag]')) return; // inputs, buttons
    maxZ.current += 1;
    setPanels(p => p.map(panel =>
      panel.id === id ? { ...panel, zIndex: maxZ.current } : panel
    ));
    setDragging({ id, startX: e.clientX, startY: e.clientY,
                  origX: panels.find(p => p.id === id).x,
                  origY: panels.find(p => p.id === id).y });
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      setPanels(p => p.map(panel =>
        panel.id === dragging.id
          ? { ...panel, x: dragging.origX + dx, y: dragging.origY + dy }
          : panel
      ));
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  return { panels, setPanels, onMouseDown };
}
```

### Panel Title Bar
```
┌─ [SYS.CFG] INVESTOR PROFILE ──────────── [−] [□] ─┐
```
- Full-width bar, `cursor: grab` / `grabbing`
- `[−]` toggles `minimized` (panel collapses to title bar only)
- `[□]` toggles `maximized` (panel expands to fill viewport, `position: fixed`)
- Inputs and buttons inside panels get `data-no-drag` to prevent drag initiation

---

## 4. Global Header

```
╔══════════════════════════════════════════════════════════╗
║  ██ AI INVESTMENT TERMINAL v2.0         14:32:07 UTC    ║
║  MULTI-AGENT SYSTEM · CLAUDE SONNET · 4 SPECIALISTS     ║
╚══════════════════════════════════════════════════════════╝
```

- Clock updates every second via `setInterval` in `useEffect`
- Fixed at top, not draggable, height ~70px
- Green border bottom

---

## 5. Component Structure

The file remains a single `InvestmentAdvisor.jsx`. Internal organization:

```
// 1. Financial math utilities      (unchanged)
// 2. Agent functions               (unchanged)
// 3. usePanels hook                (NEW)
// 4. TerminalPanel wrapper         (NEW) — handles drag, min/max, border
// 5. Panel content components      (REDESIGNED)
//    ├── SysCfgPanel
//    ├── MktInPanel
//    ├── PrcDatPanel
//    ├── AnalyticsPanel
//    └── SigOutPanel
// 6. GlobalHeader                  (NEW)
// 7. InvestmentAdvisor (main)      (UPDATED layout)
```

---

## 6. What Does NOT Change

- All financial math (RSI, MACD, SMA, EMA, volatility)
- All 4 agent functions (`runTechnicalAgent`, `runFundamentalAgent`, `runRiskAgent`, `runOrchestratorAgent`)
- `window.ENV` API key reading
- Vercel proxy routes (`api/yahoo.js`, `api/alpha.js`, `api/claude.js`)
- Auto-refresh logic
- Error handling per agent

---

## 7. Constraints

- Single JSX file, no new npm dependencies
- Tailwind inline styles supplement via `style={{}}` for terminal-specific colors not in default palette
- Recharts remains the only charting library
- No `localStorage` / `sessionStorage`
- Touch drag not required (desktop terminal aesthetic)
