/**
 * InvestmentAdvisor.jsx
 * MVP production-ready · Plataforma multi-agente de asesoría de inversiones
 *
 * Requiere:
 *   - React 18+
 *   - recharts
 *   - Tailwind CSS (clases core)
 *   - window.ENV con { ANTHROPIC_API_KEY, ALPHA_VANTAGE_API_KEY, YAHOO_FINANCE_PROXY }
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ═══════════════════════════════════════════════════════════════════════════════
// UTILIDADES MATEMÁTICO-FINANCIERAS
// ═══════════════════════════════════════════════════════════════════════════════

/** Serie de EMA de longitud completa */
const calcEMASeries = (prices, period) => {
  const k = 2 / (period + 1);
  const out = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    out.push(prices[i] * k + out[i - 1] * (1 - k));
  }
  return out;
};

/** RSI de Wilder (período = 14 por defecto) */
const calcRSI = (prices, period = 14) => {
  if (prices.length < period + 1) return 50;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
};

/** SMA de los últimos `period` precios */
const calcSMA = (prices, period) => {
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
};

/** MACD(12,26,9) — devuelve { macd, signal, histogram, bullish } */
const calcMACD = (prices) => {
  if (prices.length < 35) return { macd: 0, signal: 0, histogram: 0, bullish: false };
  const ema12 = calcEMASeries(prices, 12);
  const ema26 = calcEMASeries(prices, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMASeries(macdLine.slice(25), 9);
  const lastM = macdLine[macdLine.length - 1];
  const lastS = signalLine[signalLine.length - 1];
  const prevM = macdLine.length > 1 ? macdLine[macdLine.length - 2] : lastM;
  const prevS = signalLine.length > 1 ? signalLine[signalLine.length - 2] : lastS;
  return {
    macd: lastM,
    signal: lastS,
    histogram: lastM - lastS,
    bullish: lastM > lastS && prevM <= prevS, // cruce alcista
  };
};

/** Volatilidad anualizada de los últimos 30 días (log-returns) */
const calcVolatility30d = (prices) => {
  const p = prices.slice(-31);
  if (p.length < 2) return 0.25;
  const returns = [];
  for (let i = 1; i < p.length; i++) {
    if (p[i] > 0 && p[i - 1] > 0) returns.push(Math.log(p[i] / p[i - 1]));
  }
  if (returns.length === 0) return 0.25;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 252);
};

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTE 1 — ANÁLISIS TÉCNICO (Yahoo Finance)
// ═══════════════════════════════════════════════════════════════════════════════

const runTechnicalAgent = async (ticker, onStatus) => {
  const ENV = window.ENV || {};
  const proxy = ENV.YAHOO_FINANCE_PROXY;
  if (!proxy) throw new Error('YAHOO_FINANCE_PROXY no configurado en window.ENV');

  onStatus('fetching');
  const url = `${proxy}/v8/finance/chart/${ticker}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Yahoo Finance respondió ${res.status} para ${ticker}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo Finance: respuesta sin datos de chart');

  const quotes = result.indicators.quote[0];
  const closes = (quotes.close || []).map(Number).filter(isFinite);
  const highs  = (quotes.high  || []).map(Number).filter(isFinite);
  const timestamps = result.timestamp || [];

  if (closes.length < 50) throw new Error(`Insuficientes datos históricos para ${ticker} (${closes.length} días)`);

  const currentPrice = result.meta?.regularMarketPrice || closes[closes.length - 1];

  onStatus('analyzing');

  const rsi     = calcRSI(closes);
  const macdData = calcMACD(closes);
  const sma50   = calcSMA(closes, 50);
  const sma200  = calcSMA(closes, Math.min(200, closes.length));
  const resistance = highs.length > 0 ? Math.max(...highs.slice(-52)) : currentPrice * 1.1;

  let signal, confidence, justification;

  if (rsi > 70 && currentPrice >= resistance * 0.97) {
    signal = 'sell'; confidence = 85;
    justification = `RSI sobrecomprado (${rsi.toFixed(1)}) y precio ($${currentPrice.toFixed(2)}) cerca de resistencia de 52 semanas ($${resistance.toFixed(2)}). Presión vendedora alta.`;
  } else if (rsi < 30 && currentPrice > sma200 && macdData.bullish) {
    signal = 'buy'; confidence = 75;
    justification = `RSI sobrevendido (${rsi.toFixed(1)}), precio sobre SMA200 ($${sma200.toFixed(2)}) y cruce alcista MACD. Rebote técnico probable.`;
  } else if (sma50 > sma200) {
    signal = 'buy'; confidence = 70;
    justification = `Golden Cross confirmado: SMA50 ($${sma50.toFixed(2)}) por encima de SMA200 ($${sma200.toFixed(2)}). Tendencia alcista de mediano plazo.`;
  } else if (sma50 < sma200) {
    signal = 'sell'; confidence = 70;
    justification = `Death Cross activo: SMA50 ($${sma50.toFixed(2)}) por debajo de SMA200 ($${sma200.toFixed(2)}). Tendencia bajista dominante.`;
  } else {
    signal = 'hold'; confidence = 50;
    justification = `Sin señales técnicas claras. RSI neutro (${rsi.toFixed(1)}), precio entre medias móviles. Mercado lateral.`;
  }

  const priceHistory = closes.slice(-60).map((price, i) => ({
    price: +price.toFixed(2),
    date: timestamps.slice(-60)[i]
      ? new Date(timestamps.slice(-60)[i] * 1000).toLocaleDateString('es', { month: 'short', day: 'numeric' })
      : `D${i}`,
  }));

  return {
    signal,
    confidence,
    rsi: +rsi.toFixed(2),
    macd: +macdData.macd.toFixed(4),
    macd_signal: +macdData.signal.toFixed(4),
    macd_bullish: macdData.bullish,
    sma50: +sma50.toFixed(2),
    sma200: +sma200.toFixed(2),
    currentPrice: +currentPrice.toFixed(2),
    priceHistory,
    closes, // requerido por Agente 3
    justification,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTE 2 — ANÁLISIS FUNDAMENTAL (Alpha Vantage OVERVIEW)
// ═══════════════════════════════════════════════════════════════════════════════

const runFundamentalAgent = async (ticker, onStatus) => {
  const ENV = window.ENV || {};
  const apiKey = ENV.ALPHA_VANTAGE_API_KEY;

  onStatus('fetching');
  // Si hay key en window.ENV → llamada directa; si no → proxy server-side (Vercel)
  const url = apiKey
    ? `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`
    : `/api/alpha?function=OVERVIEW&symbol=${ticker}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage respondió ${res.status}`);

  const data = await res.json();
  if (data['Note'])        throw new Error('Alpha Vantage: límite de peticiones alcanzado (5/min en plan free)');
  if (data['Information']) throw new Error(`Alpha Vantage: ${data['Information'].slice(0, 120)}`);
  if (!data.Symbol)        throw new Error(`Símbolo ${ticker} no encontrado en Alpha Vantage`);

  onStatus('analyzing');

  const fv = (key, fallback = 0) => {
    const v = parseFloat(data[key]);
    return isFinite(v) ? v : fallback;
  };

  const pe          = fv('PERatio');
  const roe         = fv('ReturnOnEquityTTM') * 100;
  const peg         = fv('PEGRatio');
  const payoutRatio = fv('PayoutRatio') * 100;
  const fcf         = fv('OperatingCashflowTTM'); // mejor proxy de FCF en OVERVIEW
  const epsGrowth   = fv('QuarterlyEarningsGrowthYOY') * 100;
  const beta        = fv('Beta', 1.0);
  const sectorPE    = 20; // promedio de mercado como proxy del sector

  let qualityScore = 0;
  const breakdown = [];

  if (roe > 15)                             { qualityScore += 25; breakdown.push(`ROE ${roe.toFixed(1)}%>15% (+25)`); }
  if (payoutRatio < 40 || payoutRatio === 0){ qualityScore += 20; breakdown.push(`Payout ${payoutRatio.toFixed(0)}%<40% (+20)`); }
  if (fcf > 0)                              { qualityScore += 20; breakdown.push('FCF>0 (+20)'); }
  if (pe > 0 && pe < sectorPE * 0.9 && peg > 0 && peg < 1) {
    qualityScore += 20;
    breakdown.push(`P/E ${pe.toFixed(1)}<sector·0.9 y PEG ${peg.toFixed(2)}<1 (+20)`);
  }
  if (epsGrowth > 10)                       { qualityScore += 15; breakdown.push(`EPS growth ${epsGrowth.toFixed(1)}%>10% (+15)`); }

  let signal, confidence, valuation;
  if (qualityScore > 70)      { signal = 'buy';  confidence = 80; valuation = 'undervalued'; }
  else if (qualityScore >= 50){ signal = 'hold'; confidence = 60; valuation = 'fair'; }
  else                        { signal = 'sell'; confidence = 70; valuation = 'overvalued'; }

  const justification = `Quality score: ${qualityScore}/100. ${breakdown.join(' | ')}. P/E: ${pe.toFixed(2)}, ROE: ${roe.toFixed(1)}%, PEG: ${peg.toFixed(2)}.`;

  return {
    signal,
    confidence,
    pe:           +pe.toFixed(2),
    roe:          +roe.toFixed(2),
    peg:          +peg.toFixed(2),
    beta:         +beta.toFixed(2),
    payout_ratio: +payoutRatio.toFixed(2),
    eps_growth:   +epsGrowth.toFixed(2),
    quality_score: qualityScore,
    valuation,
    justification,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTE 3 — GESTIÓN DE RIESGO (determinístico, sin LLM)
// ═══════════════════════════════════════════════════════════════════════════════

const runRiskAgent = (techResult, fundResult, profile) => {
  const closes       = techResult?.closes       || [];
  const currentPrice = techResult?.currentPrice || 0;
  const beta         = fundResult?.beta         || 1.0;
  const correlation  = 0.5; // default estático

  const vol     = calcVolatility30d(closes); // anualizada
  const dailyVol = vol / Math.sqrt(252);
  const var95   = dailyVol * 1.645 * currentPrice;

  const baseWeights = { conservative: 5, moderate: 8, aggressive: 12 };
  let maxWeight = baseWeights[profile.risk_profile] || 8;
  if (correlation > 0.8) maxWeight *= 0.7;

  let riskLevel;
  if      (vol < 0.20 && beta < 1.0) riskLevel = 'low';
  else if (vol > 0.40 || beta > 1.5) riskLevel = 'high';
  else                                riskLevel = 'moderate';

  return {
    risk_level:                riskLevel,
    max_weight:                +maxWeight.toFixed(2),
    var_95:                    +var95.toFixed(2),
    volatility_30d:            +(vol * 100).toFixed(2),
    beta:                      +beta.toFixed(2),
    correlation_with_portfolio: correlation,
    justification: `Volatilidad anualizada: ${(vol * 100).toFixed(1)}%, Beta: ${beta.toFixed(2)}, VaR(95%/día): $${var95.toFixed(2)}/acción. Correlación estimada con cartera: ${correlation}. Nivel de riesgo: ${riskLevel}. Peso máximo recomendado: ${maxWeight.toFixed(1)}% del capital.`,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTE 4 — ORQUESTADOR (Claude Sonnet)
// ═══════════════════════════════════════════════════════════════════════════════

const runOrchestratorAgent = async (tech, fund, risk, profile, onStatus) => {
  const ENV = window.ENV || {};
  const apiKey = ENV.ANTHROPIC_API_KEY;
  // Si hay key en window.ENV → llamada directa con header de browser-access
  // Si no → proxy server-side /api/claude (Vercel, key guardada en env vars)
  const useProxy = !apiKey;

  onStatus('analyzing');

  // Excluir el array closes para no inflar el payload
  const techSummary = tech ? { ...tech, closes: undefined, priceHistory: undefined } : tech;

  const payload = {
    technical_analysis:  techSummary,
    fundamental_analysis: fund,
    risk_management:     risk,
    investor_profile: {
      capital:            profile.capital,
      risk_profile:       profile.risk_profile,
      time_horizon:       profile.time_horizon,
      preferred_sectors:  profile.preferred_sectors,
    },
  };

  const systemPrompt = `Eres un orquestador financiero experto. Dados los análisis de tres agentes especialistas y el perfil del inversor:
1. Detecta contradicciones entre señales de los agentes
2. Asigna pesos según horizonte temporal:
   - Horizonte mediano (medium): fundamental 50%, técnico 30%, riesgo 20%
   - Horizonte corto (short): técnico 50%, fundamental 30%, riesgo 20%
   - Horizonte largo (long): fundamental 60%, riesgo 25%, técnico 15%
3. Calcula score de confianza ponderado
4. Genera recomendación accionable

Responde ÚNICAMENTE con JSON válido (sin markdown, sin texto antes/después) con exactamente esta estructura:
{
  "final_action": "buy" | "sell" | "hold",
  "portfolio_weight": <número: porcentaje del portfolio, respeta max_weight del agente de riesgo>,
  "confidence_score": <número 0-100>,
  "time_horizon": "short" | "medium" | "long",
  "price_target": <número: precio objetivo realista a 12 meses>,
  "stop_loss": <número: nivel de stop loss técnico conservador>,
  "contradiction_detected": <boolean: true si agentes tienen señales opuestas>,
  "justification_multicriteria": "<string: síntesis integrada en 2-3 oraciones con los factores clave>"
}`;

  const claudeEndpoint = useProxy
    ? '/api/claude'
    : 'https://api.anthropic.com/v1/messages';

  const claudeHeaders = useProxy
    ? { 'Content-Type': 'application/json' }
    : {
        'Content-Type':                              'application/json',
        'x-api-key':                                 apiKey,
        'anthropic-version':                         '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };

  const res = await fetch(claudeEndpoint, {
    method: 'POST',
    headers: claudeHeaders,
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     systemPrompt,
      messages: [{
        role:    'user',
        content: `Genera la recomendación de inversión con estos datos:\n\n${JSON.stringify(payload, null, 2)}`,
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Orquestador no devolvió JSON válido');

  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error('JSON del orquestador malformado');
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS — v2.0 Bloomberg Terminal
// ═══════════════════════════════════════════════════════════════════════════════

const T = {
  bg:       '#f8fafc',
  bgPanel:  '#ffffff',
  bgHeader: '#1e3a8a',
  green:    '#1e40af',
  greenMid: '#64748b',
  greenDark:'#e2e8f0',
  greenGlow:'rgba(30,64,175,0.1)',
  red:      '#dc2626',
  yellow:   '#d97706',
  font:     "'Courier New', Courier, monospace",
};

const SCANLINES = 'none';

const HEADER_H = 70; // px — height of fixed global header

/** ASCII progress bar: 10 chars, filled █ vs empty ░ */
const bar = (pct) => {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

/** Dot-leader row for monospace column alignment */
const row = (label, value, width = 22) => {
  const v = String(value);
  const dots = '.'.repeat(Math.max(1, width - label.length - v.length));
  return `${label}${dots}${v}`;
};

/** Status badge config */
const BADGE = {
  idle:      { text: '[IDLE ]', color: T.greenDark,  pulse: false },
  waiting:   { text: '[WAIT ]', color: T.greenMid,   pulse: false },
  fetching:  { text: '[FETCH]', color: T.green,       pulse: true  },
  analyzing: { text: '[ANLZ.]', color: T.green,       pulse: true  },
  ready:     { text: '[READY]', color: T.green,       pulse: false },
  error:     { text: '[ERR! ]', color: T.red,         pulse: false },
};

/** Stage → progress % for agent pipeline */
const STAGE_PCT = { idle: 0, waiting: 10, fetching: 40, analyzing: 70, ready: 100, error: 100 };

/** Initial positions for 5 panels */
const INITIAL_PANELS = [
  { id: 'syscfg',  x: 20,  y: HEADER_H + 10, width: 340, height: 380, zIndex: 1, minimized: false, maximized: false },
  { id: 'mktin',   x: 380, y: HEADER_H + 10, width: 380, height: 400, zIndex: 2, minimized: false, maximized: false },
  { id: 'prcdat',  x: 780, y: HEADER_H + 10, width: 420, height: 300, zIndex: 3, minimized: false, maximized: false },
  { id: 'anlytcs', x: 20,  y: HEADER_H + 420, width: 560, height: 320, zIndex: 4, minimized: false, maximized: false },
  { id: 'sigout',  x: 600, y: HEADER_H + 340, width: 610, height: 460, zIndex: 5, minimized: false, maximized: false },
];

/** Animates "." ".." "..." cycling every 400ms — used in agent status display */
function useDots(active) {
  const [dots, setDots] = React.useState('.');
  React.useEffect(() => {
    if (!active) { setDots('.'); return; }
    const id = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 400);
    return () => clearInterval(id);
  }, [active]);
  return dots;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: usePanels — drag, minimize, maximize state for all 5 panels
// ─────────────────────────────────────────────────────────────────────────────

function usePanels() {
  const [panels, setPanels] = React.useState(INITIAL_PANELS);
  const [dragging, setDragging] = React.useState(null);
  const maxZRef = React.useRef(10);
  const panelsRef = React.useRef(panels);

  React.useEffect(() => { panelsRef.current = panels; }, [panels]);

  const onTitleMouseDown = React.useCallback((id, e) => {
    if (e.target.closest('[data-no-drag]')) return;
    e.preventDefault();
    maxZRef.current += 1;
    const cur = panelsRef.current.find(p => p.id === id);
    setPanels(prev => prev.map(p => p.id === id ? { ...p, zIndex: maxZRef.current } : p));
    setDragging({ id, startMouseX: e.clientX, startMouseY: e.clientY, origPanelX: cur.x, origPanelY: cur.y });
  }, []);

  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const panel = panelsRef.current.find(p => p.id === dragging.id);
      if (!panel || panel.maximized) return;
      const dx = e.clientX - dragging.startMouseX;
      const dy = e.clientY - dragging.startMouseY;
      const newX = Math.max(0, Math.min(window.innerWidth - panel.width, dragging.origPanelX + dx));
      const newY = Math.max(HEADER_H, Math.min(window.innerHeight - 36, dragging.origPanelY + dy));
      setPanels(prev => prev.map(p => p.id === dragging.id ? { ...p, x: newX, y: newY } : p));
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const toggleMinimize = React.useCallback((id) =>
    setPanels(prev => prev.map(p => p.id === id ? { ...p, minimized: !p.minimized } : p)), []);

  const toggleMaximize = React.useCallback((id) =>
    setPanels(prev => prev.map(p => p.id === id ? { ...p, maximized: !p.maximized, minimized: false } : p)), []);

  return { panels, onTitleMouseDown, toggleMinimize, toggleMaximize };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: TerminalPanel — draggable panel shell used by all 5 panels
// ─────────────────────────────────────────────────────────────────────────────

function TerminalPanel({ panel, title, onMouseDown, onMinimize, onMaximize, children }) {
  const isMax = panel.maximized;
  const containerStyle = isMax
    ? { position: 'fixed', top: HEADER_H, left: 0, right: 0, bottom: 0, zIndex: panel.zIndex }
    : { position: 'absolute', left: panel.x, top: panel.y, width: panel.width, zIndex: panel.zIndex };

  return (
    <div style={{
      ...containerStyle,
      background: T.bgPanel,
      border: `1px solid ${T.greenDark}`,
      boxShadow: `0 0 14px ${T.greenGlow}, 0 0 1px ${T.greenDark}`,
      fontFamily: T.font,
    }}>
      {/* ── Title bar (drag handle) ── */}
      <div
        onMouseDown={(e) => !isMax && onMouseDown(panel.id, e)}
        style={{
          background: T.bgHeader,
          cursor: isMax ? 'default' : 'grab',
          padding: '5px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${T.greenDark}`,
          userSelect: 'none',
          height: 28,
        }}
      >
        <span style={{ color: '#ffffff', fontSize: 11, letterSpacing: '0.05em' }}>
          ─ {title} ─
        </span>
        <span data-no-drag style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, display: 'flex', gap: 10 }}>
          <span
            onClick={onMinimize}
            style={{ cursor: 'pointer', padding: '0 2px' }}
            title={panel.minimized ? 'Restore' : 'Minimize'}
          >
            [{panel.minimized ? '+' : '−'}]
          </span>
          <span
            onClick={onMaximize}
            style={{ cursor: 'pointer', padding: '0 2px' }}
            title={isMax ? 'Restore' : 'Maximize'}
          >
            [{isMax ? '▣' : '□'}]
          </span>
        </span>
      </div>

      {/* ── Panel content (hidden when minimized) ── */}
      {!panel.minimized && (
        <div
          data-no-drag
          style={{
            padding: 12,
            overflowY: 'auto',
            height: isMax ? `calc(100% - 28px)` : panel.height - 28,
            color: T.green,
            fontSize: 12,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: GlobalHeader — fixed top bar with clock
// ─────────────────────────────────────────────────────────────────────────────

function GlobalHeader({ autoRefresh }) {
  const [time, setTime] = React.useState('');
  React.useEffect(() => {
    const update = () => setTime(new Date().toUTCString().slice(17, 25));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: HEADER_H,
      zIndex: 9999, background: T.bg,
      borderBottom: `1px solid rgba(255,255,255,0.2)`,
      fontFamily: T.font, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '0 20px',
    }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, letterSpacing: '0.1em' }}>
        ╔{'═'.repeat(60)}╗
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#ffffff', fontSize: 13, fontWeight: 'bold', letterSpacing: '0.08em' }}>
          ██ AI INVESTMENT TERMINAL v2.0
        </span>
        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, display: 'flex', gap: 16 }}>
          {autoRefresh && <span style={{ color: T.yellow }}>● AUTO-REFRESH ON</span>}
          <span>{time} UTC</span>
        </span>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: '0.06em' }}>
        ╚═ MULTI-AGENT SYSTEM · CLAUDE SONNET · 4 SPECIALISTS ═╝
      </div>
    </div>
  );
}

function MobileFallback() {
  return (
    <div style={{
      background: T.bg, color: T.green, fontFamily: T.font,
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 8, fontSize: 13,
    }}>
      <div>╔{'═'.repeat(30)}╗</div>
      <div>║{'  '}TERMINAL MODE{'          '}║</div>
      <div>║{'  '}Requires desktop browser{'  '}║</div>
      <div>║{'  '}min-width: 900px{'         '}║</div>
      <div>╚{'═'.repeat(30)}╝</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [SYS.CFG] — Investor Profile config
// ─────────────────────────────────────────────────────────────────────────────

function SysCfgPanel({ profile, setProfile, autoRefresh, setAutoRefresh }) {
  const inputStyle = {
    background: T.bg, color: T.green, border: `1px solid ${T.greenDark}`,
    fontFamily: T.font, fontSize: 12, padding: '3px 6px', width: '100%',
    outline: 'none', caretColor: T.green,
  };
  const labelStyle = { color: T.greenMid, fontSize: 11, letterSpacing: '0.08em', display: 'block', marginBottom: 2 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={labelStyle}>CAPITAL (USD)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: T.greenMid, fontSize: 12 }}>$</span>
          <input
            data-no-drag type="number" min={0}
            value={profile.capital}
            onChange={e => setProfile(p => ({ ...p, capital: parseFloat(e.target.value) || 0 }))}
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>RISK PROFILE</label>
        <select
          data-no-drag
          value={profile.risk_profile}
          onChange={e => setProfile(p => ({ ...p, risk_profile: e.target.value }))}
          style={{ ...inputStyle }}
        >
          <option value="conservative">CONSERVATIVE</option>
          <option value="moderate">MODERATE</option>
          <option value="aggressive">AGGRESSIVE</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>TIME HORIZON</label>
        <select
          data-no-drag
          value={profile.time_horizon}
          onChange={e => setProfile(p => ({ ...p, time_horizon: e.target.value }))}
          style={{ ...inputStyle }}
        >
          <option value="short">SHORT (&lt;1 year)</option>
          <option value="medium">MEDIUM (1–3 years)</option>
          <option value="long">LONG (&gt;3 years)</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>SECTORS (comma-separated)</label>
        <input
          data-no-drag type="text"
          value={profile.preferred_sectors.join(', ')}
          onChange={e => setProfile(p => ({
            ...p,
            preferred_sectors: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
          }))}
          placeholder="Technology, Finance..."
          style={{ ...inputStyle }}
        />
      </div>

      <div
        onClick={() => setAutoRefresh(v => !v)}
        style={{ cursor: 'pointer', borderTop: `1px solid ${T.greenDark}`, paddingTop: 10 }}
      >
        <label style={{ ...labelStyle, cursor: 'pointer' }}>AUTO-REFRESH (15 min)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: autoRefresh ? T.greenDark : T.green }}>[OFF]</span>
          <span style={{ color: T.greenMid }}>{autoRefresh ? '●───' : '───●'}</span>
          <span style={{ color: autoRefresh ? T.green : T.greenDark }}>[ON]</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [MKT.IN] — Ticker input + 4 agent status cards
// ─────────────────────────────────────────────────────────────────────────────

function MktInPanel({ ticker, setTicker, isAnalyzing, onAnalyze, agentStates, agentResults, errors }) {
  const dots = useDots(isAnalyzing);
  const agents = [
    { key: 'technical',    label: 'AGENT 01 · TECHNICAL   ' },
    { key: 'fundamental',  label: 'AGENT 02 · FUNDAMENTAL ' },
    { key: 'risk',         label: 'AGENT 03 · RISK MGT    ' },
    { key: 'orchestrator', label: 'AGENT 04 · ORCHESTRATOR' },
  ];

  const signalColor = (s) => s === 'buy' ? T.green : s === 'sell' ? T.red : T.yellow;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Ticker input row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: T.greenMid, fontSize: 14 }}>{'>'}</span>
        <input
          data-no-drag
          type="text"
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && !isAnalyzing && onAnalyze()}
          maxLength={10}
          placeholder="TICKER"
          style={{
            flex: 1, background: T.bg, color: T.green,
            border: `1px solid ${T.greenDark}`, fontFamily: T.font,
            fontSize: 14, padding: '4px 8px', outline: 'none',
            caretColor: T.green, letterSpacing: '0.12em',
          }}
        />
        <button
          data-no-drag
          onClick={onAnalyze}
          disabled={isAnalyzing || !ticker.trim()}
          style={{
            background: isAnalyzing ? T.bgPanel : T.bg,
            color: isAnalyzing ? T.greenDark : T.green,
            border: `1px solid ${isAnalyzing ? T.greenDark : T.green}`,
            fontFamily: T.font, fontSize: 12, padding: '4px 10px',
            cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            letterSpacing: '0.06em',
          }}
        >
          {isAnalyzing ? `ANLZ${dots}` : 'ANALYZE ▶'}
        </button>
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${T.greenDark}` }} />

      {/* Agent status rows */}
      {agents.map(({ key, label }) => {
        const st = agentStates[key] || 'idle';
        const badge = BADGE[st] || BADGE.idle;
        const pct = STAGE_PCT[st] || 0;
        const result = agentResults[key];
        const signal = result?.signal || result?.final_action;
        const confidence = result?.confidence ?? result?.confidence_score;
        const isErr = st === 'error';

        return (
          <div key={key} style={{ fontFamily: T.font, fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ color: T.greenMid, minWidth: 200 }}>{label}</span>
              <span
                style={{ color: badge.color, minWidth: 52 }}
                className={badge.pulse ? 'animate-pulse' : ''}
              >
                {badge.text}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: isErr ? T.red : T.greenMid, letterSpacing: 2 }}>
                {bar(pct)}
              </span>
              {signal && (
                <span style={{ color: signalColor(signal), fontSize: 10, fontWeight: 'bold' }}>
                  {signal.toUpperCase()}
                </span>
              )}
              {confidence != null && (
                <span style={{ color: T.greenMid, fontSize: 10 }}>{confidence}%</span>
              )}
              {result?.risk_level && !signal && (
                <span style={{ color: T.yellow, fontSize: 10 }}>{result.risk_level.toUpperCase()}</span>
              )}
            </div>
            {errors[key] && (
              <div style={{ color: T.red, fontSize: 10, marginTop: 2 }}>
                ⚠ {errors[key].slice(0, 60)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [PRC.DAT] — Price chart + current price
// ─────────────────────────────────────────────────────────────────────────────

function PrcDatPanel({ tech, ticker }) {
  const data = tech?.priceHistory || [];
  const currentPrice = tech?.currentPrice;
  const prices = data.map(d => d.price).filter(Boolean);
  const change60 = prices.length > 1
    ? ((prices[prices.length - 1] / prices[0] - 1) * 100)
    : null;
  const isUp = change60 == null || change60 >= 0;

  if (!tech) {
    return (
      <div style={{ color: T.greenDark, fontSize: 11 }}>
        <div>{row('TICKER', '---')}</div>
        <div>{row('PRICE', '$---.--')}</div>
        <div style={{ marginTop: 12, color: T.greenDark }}>
          {'─'.repeat(40)}
        </div>
        <div style={{ marginTop: 8, color: T.greenDark, textAlign: 'center' }}>
          AWAITING DATA
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: T.green, fontSize: 14, fontWeight: 'bold', letterSpacing: '0.1em' }}>
          {ticker}
        </span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: T.green, fontSize: 18, fontWeight: 'bold', fontFamily: T.font }}>
            ${currentPrice?.toFixed(2)}
          </div>
          {change60 != null && (
            <div style={{ color: isUp ? T.green : T.red, fontSize: 11 }}>
              {isUp ? '▲' : '▼'} {change60 >= 0 ? '+' : ''}{change60.toFixed(2)}% (60d)
            </div>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${T.greenDark}`, paddingTop: 4 }}>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
            <defs>
              <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.green} stopOpacity={0.15} />
                <stop offset="100%" stopColor={T.green} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: T.greenDark, fontFamily: T.font }}
              interval={Math.floor(data.length / 5)}
              tickLine={false}
              axisLine={{ stroke: T.greenDark }}
            />
            <Tooltip
              contentStyle={{ background: T.bgPanel, border: `1px solid ${T.greenDark}`, fontFamily: T.font, fontSize: 11 }}
              labelStyle={{ color: T.greenMid }}
              itemStyle={{ color: T.green }}
            />
            <Area
              type="monotone" dataKey="price"
              stroke={T.green} strokeWidth={1.5}
              fill="url(#greenGradient)"
              dot={false}
              activeDot={{ r: 3, fill: T.green, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [ANLYTCS] — Technical, Fundamental, Risk metrics
// ─────────────────────────────────────────────────────────────────────────────

function AnalyticsPanel({ tech, fund, risk }) {
  const colStyle = {
    flex: 1, display: 'flex', flexDirection: 'column', gap: 4,
    borderRight: `1px solid ${T.greenDark}`, paddingRight: 12,
  };
  const headerStyle = {
    color: T.greenMid, fontSize: 10, letterSpacing: '0.1em',
    borderBottom: `1px solid ${T.greenDark}`, paddingBottom: 4, marginBottom: 6,
  };
  const metricStyle = { color: T.green, fontSize: 11, whiteSpace: 'pre' };
  const dash = '---';

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%' }}>
      {/* Technical */}
      <div style={colStyle}>
        <div style={headerStyle}>── TECHNICAL ──</div>
        {[
          row('RSI(14)', tech ? tech.rsi : dash),
          row('SMA 50', tech ? `$${tech.sma50}` : dash),
          row('SMA 200', tech ? `$${tech.sma200}` : dash),
          row('MACD', tech ? tech.macd : dash),
          row('TREND', tech ? (tech.sma50 > tech.sma200 ? '▲ BULL' : '▼ BEAR') : dash),
        ].map((line, i) => (
          <div key={i} style={metricStyle}>{line}</div>
        ))}
      </div>

      {/* Fundamental */}
      <div style={colStyle}>
        <div style={headerStyle}>── FUNDAMENTAL ──</div>
        {[
          row('P/E RATIO', fund ? fund.pe : dash),
          row('ROE', fund ? `${fund.roe}%` : dash),
          row('PEG RATIO', fund ? fund.peg : dash),
          row('QUALITY', fund ? `${fund.quality_score}/100` : dash),
          row('VALUATION', fund ? fund.valuation.toUpperCase() : dash),
        ].map((line, i) => (
          <div key={i} style={metricStyle}>{line}</div>
        ))}
      </div>

      {/* Risk */}
      <div style={{ ...colStyle, borderRight: 'none', paddingRight: 0 }}>
        <div style={headerStyle}>── RISK ──</div>
        {[
          row('LEVEL', risk ? risk.risk_level.toUpperCase() : dash),
          row('VOL 30D', risk ? `${risk.volatility_30d}%` : dash),
          row('VAR(95%)', risk ? `$${risk.var_95}` : dash),
          row('BETA', risk ? risk.beta : dash),
          row('MAX WT', risk ? `${risk.max_weight}%` : dash),
        ].map((line, i) => (
          <div
            key={i}
            style={{
              ...metricStyle,
              color: i === 0 && risk
                ? (risk.risk_level === 'low' ? T.green : risk.risk_level === 'high' ? T.red : T.yellow)
                : T.green,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: ConfidenceRing — animated SVG donut, value 0–100
// ─────────────────────────────────────────────────────────────────────────────

function ConfidenceRing({ value }) {
  const [displayed, setDisplayed] = React.useState(0);
  React.useEffect(() => {
    const t = setTimeout(() => setDisplayed(value), 50); // trigger CSS transition after mount
    return () => clearTimeout(t);
  }, [value]);

  const size = 120, sw = 10;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (displayed / 100) * circ;
  const color = displayed >= 70 ? T.green : displayed >= 50 ? T.yellow : T.red;

  return (
    <div style={{ position: 'relative', width: size, height: size,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size} height={size}
           style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
                stroke={T.greenDark} strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
                stroke={color} strokeWidth={sw}
                strokeDasharray={circ}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.3s ease' }} />
      </svg>
      <div style={{ position: 'relative', textAlign: 'center', fontFamily: T.font }}>
        <div style={{ color, fontSize: 20, fontWeight: 'bold', lineHeight: 1 }}>{value}</div>
        <div style={{ color: T.greenMid, fontSize: 9, marginTop: 2 }}>%</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [SIG.OUT] — Final recommendation output
// ─────────────────────────────────────────────────────────────────────────────

function SigOutPanel({ orch, tech, fund, risk, profile, errors }) {
  if (!orch) {
    return (
      <div style={{ color: T.greenDark, fontSize: 11 }}>
        <div style={{ marginBottom: 12 }}>SIGNAL......: AWAITING INPUT</div>
        <ConfidenceRing value={0} />
        <div style={{ marginTop: 12, color: T.greenDark }}>
          Run an analysis to see the recommendation.
        </div>
      </div>
    );
  }

  const action = orch.final_action?.toUpperCase() || 'HOLD';
  const actionColor = action === 'BUY' ? T.green : action === 'SELL' ? T.red : T.yellow;
  const capitalAlloc = profile.capital * (orch.portfolio_weight / 100);
  const pctTarget = tech?.currentPrice && orch.price_target
    ? ((orch.price_target / tech.currentPrice - 1) * 100).toFixed(1) : null;
  const pctStop = tech?.currentPrice && orch.stop_loss
    ? ((orch.stop_loss / tech.currentPrice - 1) * 100).toFixed(1) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 11 }}>
      {/* Action + Ring */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={{ color: T.greenDark, fontSize: 10, marginBottom: 4 }}>FINAL SIGNAL</div>
          <div style={{
            color: actionColor, fontSize: 22, fontWeight: 'bold',
            border: `1px solid ${actionColor}`, padding: '6px 16px',
            letterSpacing: '0.2em',
            boxShadow: `0 0 10px ${actionColor}40`,
          }}>
            ▓ {action} ▓
          </div>
          {orch.contradiction_detected && (
            <div style={{ color: T.yellow, fontSize: 10, marginTop: 6 }}>
              ⚠ CONTRADICTION DETECTED
            </div>
          )}
        </div>
        <div>
          <div style={{ color: T.greenDark, fontSize: 10, marginBottom: 4 }}>CONFIDENCE</div>
          <ConfidenceRing value={orch.confidence_score || 0} />
        </div>
      </div>

      {/* Metrics */}
      <div style={{ borderTop: `1px solid ${T.greenDark}`, paddingTop: 8 }}>
        {[
          row('PRICE TARGET', orch.price_target ? `$${orch.price_target.toFixed(2)}${pctTarget ? ` (${pctTarget > 0 ? '+' : ''}${pctTarget}%)` : ''}` : '---'),
          row('STOP LOSS', orch.stop_loss ? `$${orch.stop_loss.toFixed(2)}${pctStop ? ` (${pctStop}%)` : ''}` : '---'),
          row('PORTFOLIO', `${orch.portfolio_weight}% = $${capitalAlloc.toLocaleString('en', { maximumFractionDigits: 0 })}`),
          row('CONTRADICTION', orch.contradiction_detected ? 'YES ⚠' : 'NO'),
        ].map((line, i) => (
          <div key={i} style={{ color: T.green, whiteSpace: 'pre', marginBottom: 3 }}>{line}</div>
        ))}
      </div>

      {/* Multicriteria justification */}
      {orch.justification_multicriteria && (
        <div style={{ borderTop: `1px solid ${T.greenDark}`, paddingTop: 8 }}>
          <div style={{ color: T.greenMid, fontSize: 10, marginBottom: 4 }}>MULTICRITERIA ANALYSIS</div>
          {orch.justification_multicriteria.split(' ').reduce((lines, word) => {
            const last = lines[lines.length - 1];
            if ((last + ' ' + word).length > 52) lines.push('> ' + word);
            else lines[lines.length - 1] = last + ' ' + word;
            return lines;
          }, ['> ']).map((line, i) => (
            <div key={i} style={{ color: T.greenMid, fontSize: 11 }}>{line}</div>
          ))}
        </div>
      )}

      {/* Agent signal breakdown */}
      <div style={{ borderTop: `1px solid ${T.greenDark}`, paddingTop: 8 }}>
        <div style={{ color: T.greenMid, fontSize: 10, marginBottom: 4 }}>── AGENT SIGNALS ──</div>
        {[
          tech && { label: 'TECHNICAL',   signal: tech.signal,      conf: tech.confidence, justification: tech.justification },
          fund && { label: 'FUNDAMENTAL', signal: fund.signal,      conf: fund.confidence, justification: fund.justification },
          risk && { label: 'RISK MGMT',   signal: risk.risk_level,  conf: null,            justification: risk.justification },
        ].filter(Boolean).map(({ label, signal, conf, justification }, i) => {
          const sig = signal?.toUpperCase() || '---';
          const sigColor = sig === 'BUY' ? T.green : sig === 'SELL' ? T.red : T.yellow;
          return (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                <span style={{ color: T.greenMid, minWidth: 100 }}>{label}</span>
                <span style={{ color: sigColor, minWidth: 60 }}>{sig}</span>
                {conf != null && <span style={{ color: T.greenDark }}>{conf}%</span>}
              </div>
              {justification && (
                <div style={{ color: T.greenDark, fontSize: 10, marginTop: 2, paddingLeft: 8 }}>
                  {'> '}{justification.slice(0, 70)}{justification.length > 70 ? '…' : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT — InvestmentAdvisor v2.0
// ═══════════════════════════════════════════════════════════════════════════════

export default function InvestmentAdvisor() {
  // ── Investor profile ───────────────────────────────────────────────────────
  const [profile, setProfile] = React.useState({
    capital: 50000, risk_profile: 'moderate',
    time_horizon: 'medium', preferred_sectors: [],
  });

  // ── Ticker + analysis state ────────────────────────────────────────────────
  const [ticker, setTicker] = React.useState('AAPL');
  const [isAnalyzing, setAnalyzing] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(false);

  const [agentStates, setAgentStates] = React.useState({
    technical: 'idle', fundamental: 'idle', risk: 'idle', orchestrator: 'idle',
  });
  const [agentResults, setAgentResults] = React.useState({
    technical: null, fundamental: null, risk: null, orchestrator: null,
  });
  const [errors, setErrors] = React.useState({});

  // ── Panel drag system ──────────────────────────────────────────────────────
  const { panels, onTitleMouseDown, toggleMinimize, toggleMaximize } = usePanels();

  // ── Mobile detection ───────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 900);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // ── Analysis orchestration (unchanged logic) ───────────────────────────────
  const isAnalyzingRef = React.useRef(false);
  const autoRefreshRef = React.useRef(null);

  const setAgentState = React.useCallback((agent, status) => {
    setAgentStates(prev => ({ ...prev, [agent]: status }));
  }, []);

  const runAnalysis = React.useCallback(async () => {
    if (!ticker.trim() || isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;
    setAnalyzing(true);
    setErrors({});
    setAgentResults({ technical: null, fundamental: null, risk: null, orchestrator: null });
    setAgentStates({ technical: 'fetching', fundamental: 'fetching', risk: 'waiting', orchestrator: 'waiting' });

    const sym = ticker.trim().toUpperCase();
    let techResult = null, fundResult = null, riskResult = null;
    const newErrors = {};

    const [techOutcome, fundOutcome] = await Promise.allSettled([
      runTechnicalAgent(sym, s => setAgentState('technical', s)),
      runFundamentalAgent(sym, s => setAgentState('fundamental', s)),
    ]);

    if (techOutcome.status === 'fulfilled') {
      techResult = techOutcome.value;
      setAgentResults(p => ({ ...p, technical: techResult }));
      setAgentState('technical', 'ready');
    } else {
      newErrors.technical = techOutcome.reason?.message || 'Error en análisis técnico';
      setAgentState('technical', 'error');
    }

    if (fundOutcome.status === 'fulfilled') {
      fundResult = fundOutcome.value;
      setAgentResults(p => ({ ...p, fundamental: fundResult }));
      setAgentState('fundamental', 'ready');
    } else {
      newErrors.fundamental = fundOutcome.reason?.message || 'Error en análisis fundamental';
      setAgentState('fundamental', 'error');
    }

    setAgentState('risk', 'analyzing');
    try {
      riskResult = runRiskAgent(techResult, fundResult, profile);
      setAgentResults(p => ({ ...p, risk: riskResult }));
      setAgentState('risk', 'ready');
    } catch (e) {
      newErrors.risk = e?.message || 'Error en gestión de riesgo';
      setAgentState('risk', 'error');
    }

    setErrors({ ...newErrors });

    if (techResult || fundResult) {
      setAgentState('orchestrator', 'fetching');
      try {
        const orchResult = await runOrchestratorAgent(
          techResult  || { error: newErrors.technical },
          fundResult  || { error: newErrors.fundamental },
          riskResult  || { error: newErrors.risk },
          profile, s => setAgentState('orchestrator', s),
        );
        setAgentResults(p => ({ ...p, orchestrator: orchResult }));
        setAgentState('orchestrator', 'ready');
      } catch (e) {
        setErrors(p => ({ ...p, orchestrator: e?.message || 'Error en orquestador' }));
        setAgentState('orchestrator', 'error');
      }
    } else {
      setErrors(p => ({ ...p, orchestrator: 'Datos insuficientes' }));
      setAgentState('orchestrator', 'error');
    }

    isAnalyzingRef.current = false;
    setAnalyzing(false);
  }, [ticker, profile, setAgentState]);

  React.useEffect(() => {
    clearInterval(autoRefreshRef.current);
    if (autoRefresh) autoRefreshRef.current = setInterval(runAnalysis, 15 * 60 * 1000);
    return () => clearInterval(autoRefreshRef.current);
  }, [autoRefresh, runAnalysis]);

  // ── Panel helpers ──────────────────────────────────────────────────────────
  const panelProps = (id) => {
    const panel = panels.find(p => p.id === id);
    return {
      panel,
      onMouseDown: onTitleMouseDown,
      onMinimize: () => toggleMinimize(id),
      onMaximize: () => toggleMaximize(id),
    };
  };

  const orch = agentResults.orchestrator;
  const tech = agentResults.technical;
  const fund = agentResults.fundamental;
  const risk = agentResults.risk;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isMobile) return <MobileFallback />;

  return (
    <div style={{
      background: T.bg,
      backgroundImage: SCANLINES,
      minHeight: '100vh',
      fontFamily: T.font,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <GlobalHeader autoRefresh={autoRefresh} />

      {/* Canvas for draggable panels */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>

        <TerminalPanel {...panelProps('syscfg')} title="[SYS.CFG] INVESTOR PROFILE">
          <SysCfgPanel
            profile={profile} setProfile={setProfile}
            autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
          />
        </TerminalPanel>

        <TerminalPanel {...panelProps('mktin')} title="[MKT.IN] MARKET INPUT">
          <MktInPanel
            ticker={ticker} setTicker={setTicker}
            isAnalyzing={isAnalyzing} onAnalyze={runAnalysis}
            agentStates={agentStates} agentResults={agentResults} errors={errors}
          />
        </TerminalPanel>

        <TerminalPanel {...panelProps('prcdat')} title="[PRC.DAT] PRICE DATA">
          <PrcDatPanel tech={tech} ticker={ticker.toUpperCase()} />
        </TerminalPanel>

        <TerminalPanel {...panelProps('anlytcs')} title="[ANLYTCS] ANALYTICS">
          <AnalyticsPanel tech={tech} fund={fund} risk={risk} />
        </TerminalPanel>

        <TerminalPanel {...panelProps('sigout')} title="[SIG.OUT] SIGNAL OUTPUT">
          <SigOutPanel
            orch={orch} tech={tech} fund={fund} risk={risk}
            profile={profile} errors={errors}
          />
        </TerminalPanel>

      </div>
    </div>
  );
}

