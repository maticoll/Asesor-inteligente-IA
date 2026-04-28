# Frontend v2.0 Design Spec — AI Investment Terminal

**Date:** 2026-04-28  
**Project:** AI Investment Advisor (InvestmentAdvisor.jsx)  
**Status:** Approved — rev 2 (post spec-review)

---

## Overview

Redesign the frontend from a static sidebar+panel layout to a Bloomberg-style financial terminal with draggable panels, green-on-black monospace aesthetic, and richer data visualization. All logic remains in the single `InvestmentAdvisor.jsx` file. No new npm dependencies beyond existing React and Recharts.

**Expected file size after v2.0:** ~1600–1800 lines (up from ~1100). Single file is intentional per project constraint.

---

## 1. Visual Design System

### Color Palette — Inline Styles Only

All custom colors are applied via `style={{}}` inline props. **Do NOT add anything to `tailwind.config.js`** and do not use Tailwind class names for these custom colors (they would silently do nothing without config changes).

```javascript
// Use this constants object at the top of the file
const T = {
  bg:          '#000000',
  bgPanel:     '#050f05',
  bgHeader:    '#001a00',
  green:       '#00ff41',
  greenMid:    '#00cc33',
  greenDark:   '#003311',
  greenGlow:   'rgba(0,255,65,0.12)',
  red:         '#ff3333',
  yellow:      '#ffcc00',
  font:        "'Courier New', Courier, monospace",
};
```

Tailwind may still be used for spacing (`p-4`, `mt-2`, `flex`, `grid`, etc.) — just not for colors.

### Typography
- **Font family:** `T.font` applied to the root wrapper `style={{ fontFamily: T.font }}`
- **Numbers/values:** right-aligned in their column
- **Labels:** uppercase, `letterSpacing: '0.08em'`

### Scanlines Effect
Applied as a `backgroundImage` on the root wrapper div. **Do NOT use `::before` pseudo-elements** (requires a CSS stylesheet not available in this stack).

```javascript
backgroundImage: 'repeating-linear-gradient(transparent 0px, transparent 3px, rgba(0,255,65,0.025) 3px, rgba(0,255,65,0.025) 4px)'
```

### Analyzing Animation
When any agent is in `fetching` or `analyzing` state, show animated dots:
```javascript
// useEffect with setInterval(100ms) cycling:
// ">>> ANALIZANDO." → ">>> ANALIZANDO.." → ">>> ANALIZANDO..."
```
Implemented via a `useDots()` hook that returns the current dot string.

### Agent Status Badges
Monospace bracketed strings with inline color:

| State | Badge | Color |
|---|---|---|
| idle | `[IDLE ]` | `T.greenDark` |
| waiting | `[WAIT ]` | `T.greenMid` dim |
| fetching | `[FETCH]` | `T.green` + `animate-pulse` |
| analyzing | `[ANLZ.]` | `T.green` + `animate-pulse` |
| ready | `[READY]` | `T.green` |
| error | `[ERR! ]` | `T.red` |

### ASCII Progress Bar
10-char bar filling proportionally to agent pipeline stage (0→fetch→analyze→ready = 0→33→66→100%):
```javascript
const bar = (pct) => {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};
```

### Dot Leaders (ANLYTCS panel)
Use JS string padding in monospace. Labels are left-padded to a fixed width, values right-padded:
```javascript
const row = (label, value, width = 22) => {
  const dots = '.'.repeat(Math.max(1, width - label.length - String(value).length));
  return `${label}${dots}${value}`;
};
// e.g. "RSI(14)........  62.4"
```

---

## 2. Panel Architecture

### Panel State Shape
```javascript
{
  id: string,
  x: number,          // left offset in px
  y: number,          // top offset in px
  width: number,      // px — fixed per panel, used for bounds clamping and maximize restore
  height: number,     // px — fixed per panel, used for maximize restore
  zIndex: number,     // stacking order, increases on focus
  minimized: boolean, // true → only title bar visible
  maximized: boolean, // true → position:fixed, fills viewport minus header
}
```

### Default Panel Positions (1280px viewport reference)
```javascript
const INITIAL_PANELS = [
  { id: 'syscfg',   x: 20,  y: 80,  width: 340, height: 380, zIndex: 1, minimized: false, maximized: false },
  { id: 'mktin',    x: 380, y: 80,  width: 380, height: 400, zIndex: 2, minimized: false, maximized: false },
  { id: 'prcdat',   x: 780, y: 80,  width: 420, height: 300, zIndex: 3, minimized: false, maximized: false },
  { id: 'anlytcs',  x: 20,  y: 490, width: 560, height: 320, zIndex: 4, minimized: false, maximized: false },
  { id: 'sigout',   x: 600, y: 410, width: 610, height: 460, zIndex: 5, minimized: false, maximized: false },
];
```

### Mobile Handling
On viewports narrower than 900px, render a fullscreen message instead of the panel layout:
```
╔══════════════════════════════╗
║  TERMINAL MODE               ║
║  Requires desktop browser    ║
║  min-width: 900px            ║
╚══════════════════════════════╝
```
Detect with `window.innerWidth` on mount and a resize listener. No draggable panels on mobile.

---

## 3. Drag System (`usePanels` hook)

### State and Refs
```javascript
function usePanels() {
  const [panels, setPanels] = useState(INITIAL_PANELS);
  const [dragging, setDragging] = useState(null);
  // { id, startMouseX, startMouseY, origPanelX, origPanelY }
  const maxZRef = useRef(10);
  const panelsRef = useRef(panels); // sync ref to avoid stale closures in event handlers

  useEffect(() => { panelsRef.current = panels; }, [panels]);
```

### `onTitleMouseDown(id, e)`
```javascript
  const onTitleMouseDown = (id, e) => {
    if (e.target.closest('[data-no-drag]')) return;
    e.preventDefault();
    maxZRef.current += 1;
    const current = panelsRef.current.find(p => p.id === id); // use ref, not stale closure
    setPanels(prev => prev.map(p => p.id === id ? { ...p, zIndex: maxZRef.current } : p));
    setDragging({
      id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      origPanelX: current.x,
      origPanelY: current.y,
    });
  };
```

### Mouse Move / Up (with bounds clamping)
```javascript
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const dx = e.clientX - dragging.startMouseX;
      const dy = e.clientY - dragging.startMouseY;
      const panel = panelsRef.current.find(p => p.id === dragging.id);
      const HEADER_H = 70;
      const newX = Math.max(0, Math.min(window.innerWidth - panel.width, dragging.origPanelX + dx));
      const newY = Math.max(HEADER_H, Math.min(window.innerHeight - 36, dragging.origPanelY + dy));
      // newY min = HEADER_H (never goes above header)
      // newY max = viewport - 36px (title bar always reachable)
      setPanels(prev => prev.map(p => p.id === dragging.id ? { ...p, x: newX, y: newY } : p));
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]); // dragging is the only dep; panel dimensions read via panelsRef
```

### Minimize / Maximize
```javascript
  const toggleMinimize = (id) =>
    setPanels(prev => prev.map(p => p.id === id ? { ...p, minimized: !p.minimized } : p));

  const toggleMaximize = (id) =>
    setPanels(prev => prev.map(p => p.id === id ? { ...p, maximized: !p.maximized, minimized: false } : p));

  return { panels, onTitleMouseDown, toggleMinimize, toggleMaximize };
}
```

### Maximized Panel Behavior
- When a panel is maximized: it renders as `position: fixed, top: 70px, left: 0, right: 0, bottom: 0` (fills viewport below header)
- All other panels remain rendered but are visually behind (`zIndex` lower)
- No dragging while maximized (title bar still shows minimize/restore buttons; `[□]` becomes `[▣]` to indicate restore)
- Clicking `[▣]` restores the panel to its stored `x, y, width, height`

---

## 4. `TerminalPanel` Component

Wrapper used by all 5 panels:

```jsx
function TerminalPanel({ panel, title, onMouseDown, onMinimize, onMaximize, children }) {
  const isMaximized = panel.maximized;
  const style = isMaximized
    ? { position: 'fixed', top: 70, left: 0, right: 0, bottom: 0, zIndex: panel.zIndex }
    : { position: 'absolute', left: panel.x, top: panel.y,
        width: panel.width, zIndex: panel.zIndex };

  return (
    <div style={{ ...style, background: T.bgPanel, border: `1px solid ${T.greenDark}`,
                  boxShadow: `0 0 12px ${T.greenGlow}`, fontFamily: T.font }}>
      {/* Title bar */}
      <div
        onMouseDown={(e) => onMouseDown(panel.id, e)}
        style={{ background: T.bgHeader, cursor: panel.maximized ? 'default' : 'grab',
                 padding: '4px 8px', display: 'flex', justifyContent: 'space-between',
                 borderBottom: `1px solid ${T.greenDark}`, userSelect: 'none' }}
      >
        <span style={{ color: T.green, fontSize: 11 }}>─ {title} ─</span>
        <span data-no-drag style={{ color: T.greenMid, fontSize: 11, cursor: 'pointer' }}>
          <span onClick={onMinimize} style={{ marginRight: 8 }}>[{panel.minimized ? '+' : '−'}]</span>
          <span onClick={onMaximize}>[{panel.maximized ? '▣' : '□'}]</span>
        </span>
      </div>
      {/* Content — hidden when minimized */}
      {!panel.minimized && (
        <div data-no-drag style={{ padding: 12, overflowY: 'auto',
                                   height: isMaximized ? 'calc(100% - 28px)' : panel.height - 28 }}>
          {children}
        </div>
      )}
    </div>
  );
}
```

---

## 5. Panel Content Details

### Empty / Loading States
When no analysis has run yet, panels show placeholder dashes:
- `[PRC.DAT]`: `TICKER......: ---` · `PRICE.......: $---.--` · flat line chart placeholder
- `[ANLYTCS]`: all metric values show `---`
- `[SIG.OUT]`: `SIGNAL......: AWAITING INPUT` · confidence ring at 0% greyed out

### `[SYS.CFG]` — INVESTOR PROFILE
```
CAPITAL.......: $ [50000      ]
RISK PROFILE..: [ MODERATE  ▼]
TIME HORIZON..: [ MEDIUM    ▼]
SECTORS.......: [tech, finance]
                ─────────────
AUTO-REFRESH..: [OFF] ──●── [ON]   ← full row is clickable, toggles boolean
```
All `<input>` and `<select>` elements have `data-no-drag` to prevent drag initiation on focus.  
The auto-refresh row: clicking anywhere on the row calls `setAutoRefresh(v => !v)`.

### `[MKT.IN]` — MARKET INPUT
```
> [AAPL              ] [ANALYZE ▶]

  AGENT 01 · TECHNICAL    [READY] ██████████ BUY  75%
  AGENT 02 · FUNDAMENTAL  [ANLZ.] ██████░░░░ ...
  AGENT 03 · RISK MGT     [IDLE ] ░░░░░░░░░░
  AGENT 04 · ORCHESTRATOR [WAIT ] ░░░░░░░░░░
```
Progress bar stage mapping: idle=0%, waiting=10%, fetching=40%, analyzing=70%, ready=100%, error=100% (red).

### `[PRC.DAT]` — PRICE DATA
```
AAPL                           $182.34
                               ▲ +4.2% (60d)
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
[Recharts LineChart — green stroke, area fill, no grid]
```
Recharts config:
- `stroke: T.green`, `strokeWidth: 1.5`, `dot: false`
- Area fill: `fill="url(#greenGradient)"` with a `<defs>` gradient from `#00ff4120` to transparent
- No `YAxis`, minimal `XAxis` with green tick labels
- Custom tooltip with `T.bgPanel` background and `T.green` text

### `[ANLYTCS]` — ANALYTICS (3 equal columns)
```
── TECHNICAL ─────   ── FUNDAMENTAL ──   ── RISK ────────
RSI(14)......62.4   P/E RATIO....24.3   LEVEL.....HIGH
SMA 50...$178.20    ROE..........38.2%  VOL 30d...28.4%
SMA 200..$165.40    PEG RATIO.....1.2   VaR(95%)...$4.20
MACD.....0.0024     QUALITY...75/100    BETA.......1.34
TREND....▲ BULL     VALUATION..FAIR     MAX WT.....8.0%
```
Rendered using the `row(label, value)` dot-leader function from Section 1.

### `[SIG.OUT]` — SIGNAL OUTPUT
```
FINAL SIGNAL                         CONFIDENCE
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓  BUY  ▓▓▓▓▓▓       [SVG ring — see below]
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

PRICE TARGET......: $198.00   (+8.6% from current)
STOP LOSS.........: $168.00   (-7.9% from current)
PORTFOLIO.........: 8.0% = $4,000.00
CONTRADICTION.....: NO

MULTICRITERIA ANALYSIS:
> [justification_multicriteria text, word-wrapped]

── AGENT SIGNALS ─────────────────────────────
TECHNICAL.....: BUY   75%  [justification line 1]
FUNDAMENTAL...: BUY   80%  [justification line 1]
RISK MGMT.....: MODERATE   [justification line 1]
```

---

## 6. Confidence Ring (SVG)

**Spec:** `size=120px`, `strokeWidth=10`, value range `0–100`.

```jsx
function ConfidenceRing({ value }) {
  const size = 120, sw = 10;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const color = value >= 70 ? T.green : value >= 50 ? T.yellow : T.red;
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.greenDark} strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
                strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.7s ease' }} />
      </svg>
      <div style={{ position: 'relative', textAlign: 'center', fontFamily: T.font }}>
        <div style={{ color, fontSize: 22, fontWeight: 'bold' }}>{value}</div>
        <div style={{ color: T.greenMid, fontSize: 10 }}>%</div>
      </div>
    </div>
  );
}
```

Animation: `stroke-dashoffset` transitions from `circ` (0%) to the computed offset on first render. Use `useEffect` to set value after mount for the animation to trigger.

---

## 7. Global Header

```
╔══════════════════════════════════════════════════════════╗
║  ██ AI INVESTMENT TERMINAL v2.0         14:32:07 UTC    ║
║  MULTI-AGENT SYSTEM · CLAUDE SONNET · 4 SPECIALISTS     ║
╚══════════════════════════════════════════════════════════╝
```

- `position: fixed`, `top: 0`, `left: 0`, `right: 0`, `height: 70px`, `zIndex: 9999`
- Clock: `new Date().toUTCString().slice(17, 25)` updated every second via `setInterval` in `useEffect` with cleanup
- Background: `T.bg`, border-bottom: `1px solid T.green`

---

## 8. What Does NOT Change

- Financial math utilities (RSI, MACD, SMA, EMA, volatility)
- Agent functions (`runTechnicalAgent`, `runFundamentalAgent`, `runRiskAgent`, `runOrchestratorAgent`)
- `window.ENV` API key reading and proxy fallback logic
- Vercel proxy routes (`api/yahoo.js`, `api/alpha.js`, `api/claude.js`)
- Auto-refresh 15-minute interval logic (state variable name unchanged: `autoRefresh`)
- Error handling per agent (partial data passed to orchestrator on failure)

---

## 9. Constraints

- Single JSX file, ~1600–1800 lines expected
- No new npm dependencies
- `style={{}}` inline props for all custom colors (no `tailwind.config.js` changes)
- Tailwind utility classes allowed for spacing/flex/grid only
- Recharts is the only charting library
- No `localStorage` / `sessionStorage`
- Touch/mobile drag not implemented; mobile shows "Desktop only" message at `< 900px`
