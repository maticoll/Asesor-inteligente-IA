/**
 * InvestmentAdvisor.jsx
 * MVP production-ready · Plataforma multi-agente de asesoría de inversiones
 * v3.0 — Multi-Asset Watchlist Dashboard
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

const calcEMASeries = (prices, period) => {
  const k = 2 / (period + 1);
  const out = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    out.push(prices[i] * k + out[i - 1] * (1 - k));
  }
  return out;
};

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

const calcSMA = (prices, period) => {
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
};

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
    bullish: lastM > lastS && prevM <= prevS,
  };
};

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
  onStatus('fetching');
  const url = `/api/yahoo/v8/finance/chart/${ticker}?range=1y&interval=1d`;
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

  const rsi      = calcRSI(closes);
  const macdData = calcMACD(closes);
  const sma50    = calcSMA(closes, 50);
  const sma200   = calcSMA(closes, Math.min(200, closes.length));
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
    closes,
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
  const fcf         = fv('OperatingCashflowTTM');
  const epsGrowth   = fv('QuarterlyEarningsGrowthYOY') * 100;
  const beta        = fv('Beta', 1.0);
  const sectorPE    = 20;

  let qualityScore = 0;
  const breakdown = [];

  if (roe > 15)                             { qualityScore += 25; breakdown.push(`ROE ${roe.toFixed(1)}%>15% (+25)`); }
  if (payoutRatio < 40 || payoutRatio === 0){ qualityScore += 20; breakdown.push(`Payout ${payoutRatio.toFixed(0)}%<40% (+20)`); }
  if (fcf > 0)                              { qualityScore += 20; breakdown.push('FCF>0 (+20)'); }
  if (pe > 0 && pe < sectorPE * 0.9 && peg > 0 && peg < 1) {
    qualityScore += 20;
    breakdown.push(`P/E ${pe.toFixed(1)}<sector·0.9 y PEG ${peg.toFixed(2)}<1 (+20)`);
  }
  if (epsGrowth > 10) { qualityScore += 15; breakdown.push(`EPS growth ${epsGrowth.toFixed(1)}%>10% (+15)`); }

  let signal, confidence, valuation;
  if (qualityScore > 70)      { signal = 'buy';  confidence = 80; valuation = 'undervalued'; }
  else if (qualityScore >= 50){ signal = 'hold'; confidence = 60; valuation = 'fair'; }
  else                        { signal = 'sell'; confidence = 70; valuation = 'overvalued'; }

  const justification = `Quality score: ${qualityScore}/100. ${breakdown.join(' | ')}. P/E: ${pe.toFixed(2)}, ROE: ${roe.toFixed(1)}%, PEG: ${peg.toFixed(2)}.`;

  return {
    signal,
    confidence,
    pe:            +pe.toFixed(2),
    roe:           +roe.toFixed(2),
    peg:           +peg.toFixed(2),
    beta:          +beta.toFixed(2),
    payout_ratio:  +payoutRatio.toFixed(2),
    eps_growth:    +epsGrowth.toFixed(2),
    quality_score: qualityScore,
    valuation,
    sector:        data.Sector || '',
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
  const correlation  = 0.5;

  const vol      = calcVolatility30d(closes);
  const dailyVol = vol / Math.sqrt(252);
  const var95    = dailyVol * 1.645 * currentPrice;

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
  const useProxy = !apiKey;

  onStatus('analyzing');

  const techSummary = tech ? { ...tech, closes: undefined, priceHistory: undefined } : tech;

  const payload = {
    technical_analysis:   techSummary,
    fundamental_analysis: fund,
    risk_management:      risk,
    investor_profile: {
      capital:           profile.capital,
      risk_profile:      profile.risk_profile,
      time_horizon:      profile.time_horizon,
      preferred_sectors: profile.preferred_sectors,
    },
  };

  const systemPrompt = `Eres un orquestador financiero experto. Dados los análisis de tres agentes especialistas y el perfil del inversor:
1. Detecta contradicciones entre señales de los agentes
2. Asigna pesos según horizonte temporal:
   - Horizonte corto (short, <3 meses): técnico 60%, fundamental 20%, riesgo 20%
   - Horizonte mediano (medium, 3-12 meses): técnico 30%, fundamental 50%, riesgo 20%
   - Horizonte largo (long, 1-3 años): técnico 10%, fundamental 70%, riesgo 20%
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

  const sanitize = (v) => {
    if (typeof v === 'string') return v.replace(/[\uD800-\uDFFF]/g, '');
    if (Array.isArray(v))      return v.map(sanitize);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, sanitize(val)]));
    return v;
  };

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
        content: `Genera la recomendación de inversión con estos datos:\n\n${JSON.stringify(sanitize(payload), null, 2)}`,
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
// HELPER: computeHorizonLocally — cálculo local de horizonte sin LLM
// ═══════════════════════════════════════════════════════════════════════════════

const HORIZON_WEIGHTS = {
  short:  { technical: 0.60, fundamental: 0.20, risk: 0.20 },
  medium: { technical: 0.30, fundamental: 0.50, risk: 0.20 },
  long:   { technical: 0.10, fundamental: 0.70, risk: 0.20 },
};

const computeHorizonLocally = (tech, fund, risk, horizon) => {
  const w = HORIZON_WEIGHTS[horizon] || HORIZON_WEIGHTS.medium;
  const signalVal = (s) => s === 'buy' ? 1 : s === 'sell' ? -1 : 0;
  const techVal = tech ? signalVal(tech.signal) * ((tech.confidence || 50) / 100) : 0;
  const fundVal = fund ? signalVal(fund.signal) * ((fund.confidence || 50) / 100) : 0;
  const riskVal = risk ? (risk.risk_level === 'low' ? 0.2 : risk.risk_level === 'high' ? -0.2 : 0) : 0;
  const weighted = techVal * w.technical + fundVal * w.fundamental + riskVal * w.risk;
  const final_action = weighted > 0.08 ? 'buy' : weighted < -0.08 ? 'sell' : 'hold';
  const confidence_score = Math.round(Math.min(92, Math.max(30, Math.abs(weighted) * 80 + 35)));
  const price = tech?.currentPrice || 0;
  return {
    final_action,
    confidence_score,
    portfolio_weight: risk?.max_weight || 8,
    time_horizon: horizon,
    price_target: price > 0 ? +(price * (1 + weighted * 0.12)).toFixed(2) : null,
    stop_loss: price > 0 ? +(price * (1 - 0.05 - Math.abs(weighted) * 0.03)).toFixed(2) : null,
    contradiction_detected: tech && fund
      ? (tech.signal !== fund.signal && tech.signal !== 'hold' && fund.signal !== 'hold')
      : false,
    justification_multicriteria: `Horizonte ${horizon.toUpperCase()}: técnico ${(w.technical * 100).toFixed(0)}%, fundamental ${(w.fundamental * 100).toFixed(0)}%, riesgo ${(w.risk * 100).toFixed(0)}%. Score ponderado: ${weighted.toFixed(2)}.`,
    _local: true,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
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
const HEADER_H = 70;
const BATCH_SIZE = 5;
const REFRESH_INTERVAL_SECS = 15 * 60;
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];

const PRESET_LISTS = {
  'DOW 30': [
    'AAPL','AMGN','AXP','BA','CAT','CRM','CSCO','CVX','DIS','DOW',
    'GS','HD','HON','IBM','JNJ','JPM','KO','MCD','MMM','MRK',
    'MSFT','NKE','PG','TRV','UNH','V','VZ','WMT','AMZN','NVDA',
  ],
  'NASDAQ 30': [
    'AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','COST','NFLX',
    'AMD','ADBE','QCOM','INTC','CSCO','INTU','CMCSA','PEP','AMGN','TMUS',
    'TXN','HON','AMAT','SBUX','REGN','VRTX','GILD','MU','LRCX','KLAC',
  ],
  'S&P TOP 30': [
    'UNH','JNJ','XOM','JPM','V','MA','PG','HD','LLY','ABBV',
    'PFE','BAC','KO','MRK','CVX','WMT','TMO','ACN','ABT','MDT',
    'CAT','LOW','GE','NEE','AXP','PM','BMY','ORCL','PYPL','SO',
  ],
};

const bar = (pct) => {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

const row = (label, value, width = 22) => {
  const v = String(value);
  const dots = '.'.repeat(Math.max(1, width - label.length - v.length));
  return `${label}${dots}${v}`;
};

const BADGE = {
  idle:      { text: '[IDLE ]', color: T.greenDark,  pulse: false },
  waiting:   { text: '[WAIT ]', color: T.greenMid,   pulse: false },
  fetching:  { text: '[FETCH]', color: T.green,       pulse: true  },
  analyzing: { text: '[ANLZ.]', color: T.green,       pulse: true  },
  ready:     { text: '[READY]', color: T.green,       pulse: false },
  error:     { text: '[ERR! ]', color: T.red,         pulse: false },
};

const STAGE_PCT = { idle: 0, waiting: 10, fetching: 40, analyzing: 70, ready: 100, error: 100 };

const INITIAL_PANELS = [
  { id: 'syscfg',  x: 20,   y: HEADER_H + 10,  width: 340,  height: 380, zIndex: 1, minimized: false, maximized: false },
  { id: 'mktin',   x: 380,  y: HEADER_H + 10,  width: 420,  height: 420, zIndex: 2, minimized: false, maximized: false },
  { id: 'prcdat',  x: 820,  y: HEADER_H + 10,  width: 400,  height: 300, zIndex: 3, minimized: false, maximized: false },
  { id: 'anlytcs', x: 20,   y: HEADER_H + 430, width: 1200, height: 360, zIndex: 4, minimized: false, maximized: false },
  { id: 'sigout',  x: 20,   y: HEADER_H + 810, width: 560,  height: 460, zIndex: 5, minimized: false, maximized: false },
  { id: 'prtsum',  x: 600,  y: HEADER_H + 810, width: 620,  height: 460, zIndex: 6, minimized: false, maximized: false },
];

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
// HOOK: usePanels
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
// COMPONENT: TerminalPanel
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
          <span onClick={onMinimize} style={{ cursor: 'pointer', padding: '0 2px' }}
            title={panel.minimized ? 'Restore' : 'Minimize'}>
            [{panel.minimized ? '+' : '−'}]
          </span>
          <span onClick={onMaximize} style={{ cursor: 'pointer', padding: '0 2px' }}
            title={isMax ? 'Restore' : 'Maximize'}>
            [{isMax ? '▣' : '□'}]
          </span>
        </span>
      </div>
      {!panel.minimized && (
        <div data-no-drag style={{
          padding: 12,
          overflowY: 'auto',
          height: isMax ? `calc(100% - 28px)` : panel.height - 28,
          color: T.green,
          fontSize: 12,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: GlobalHeader — con auto-refresh toggle y countdown
// ─────────────────────────────────────────────────────────────────────────────

function GlobalHeader({ autoRefresh, onToggleAutoRefresh, countdown, batchProgress }) {
  const [time, setTime] = React.useState('');
  React.useEffect(() => {
    const update = () => setTime(new Date().toUTCString().slice(17, 25));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const formatCountdown = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: HEADER_H,
      zIndex: 9999, background: T.bgHeader,
      borderBottom: `1px solid rgba(255,255,255,0.2)`,
      fontFamily: T.font, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '0 20px',
    }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, letterSpacing: '0.1em' }}>
        ╔{'═'.repeat(60)}╗
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#ffffff', fontSize: 13, fontWeight: 'bold', letterSpacing: '0.08em' }}>
          ██ AI INVESTMENT TERMINAL v3.0
        </span>
        <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, display: 'flex', gap: 20, alignItems: 'center' }}>
          {batchProgress.running && (
            <span style={{ color: T.yellow }}>
              ▶ Analizando {batchProgress.current}/{batchProgress.total} activos...
            </span>
          )}
          {autoRefresh && countdown > 0 && !batchProgress.running && (
            <span style={{ color: '#93c5fd' }}>
              ⏱ Próximo análisis en {formatCountdown(countdown)}
            </span>
          )}
          <span
            data-no-drag
            onClick={onToggleAutoRefresh}
            style={{
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '2px 8px',
              border: `1px solid ${autoRefresh ? '#60a5fa' : 'rgba(255,255,255,0.3)'}`,
              borderRadius: 2,
              color: autoRefresh ? '#60a5fa' : 'rgba(255,255,255,0.5)',
            }}
          >
            {autoRefresh ? '● AUTO-REFRESH ON' : '○ AUTO-REFRESH OFF'}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>{time} UTC</span>
        </span>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: '0.06em' }}>
        ╚═ MULTI-AGENT SYSTEM · CLAUDE SONNET · 4 SPECIALISTS · MULTI-ASSET WATCHLIST ═╝
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

function SysCfgPanel({ profile, setProfile }) {
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
        <select data-no-drag value={profile.risk_profile}
          onChange={e => setProfile(p => ({ ...p, risk_profile: e.target.value }))}
          style={{ ...inputStyle }}>
          <option value="conservative">CONSERVATIVE</option>
          <option value="moderate">MODERATE</option>
          <option value="aggressive">AGGRESSIVE</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>TIME HORIZON</label>
        <select data-no-drag value={profile.time_horizon}
          onChange={e => setProfile(p => ({ ...p, time_horizon: e.target.value }))}
          style={{ ...inputStyle }}>
          <option value="short">SHORT (&lt;3 months)</option>
          <option value="medium">MEDIUM (3–12 months)</option>
          <option value="long">LONG (1–3 years)</option>
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [MKT.IN] — Watchlist + Batch Progress
// ─────────────────────────────────────────────────────────────────────────────

function WatchlistPanel({ watchlist, setWatchlist, isRunning, onAnalyzeAll, batchProgress, assetData }) {
  const [inputVal, setInputVal] = React.useState('');
  const dots = useDots(isRunning);

  const addTicker = () => {
    const t = inputVal.trim().toUpperCase();
    if (!t || watchlist.includes(t) || watchlist.length >= 100) return;
    setWatchlist(prev => [...prev, t]);
    setInputVal('');
  };

  const removeTicker = (t) => setWatchlist(prev => prev.filter(x => x !== t));

  const loadPreset = (name) => {
    const tickers = PRESET_LISTS[name];
    if (!tickers) return;
    setWatchlist(tickers.slice(0, 100));
  };

  const readyCount = watchlist.filter(t => assetData[t]?.status === 'ready').length;
  const errorCount = watchlist.filter(t => assetData[t]?.status === 'error').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Preset lists */}
      <div>
        <div style={{ color: T.greenMid, fontSize: 10, letterSpacing: '0.08em', marginBottom: 5 }}>
          ─ LISTAS PREDEFINIDAS ─
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(PRESET_LISTS).map(([name, tickers]) => (
            <button
              key={name}
              data-no-drag
              onClick={() => loadPreset(name)}
              disabled={isRunning}
              title={`Cargar ${tickers.length} activos: ${tickers.slice(0, 5).join(', ')}...`}
              style={{
                background: T.bg,
                color: T.green,
                border: `1px solid ${T.greenDark}`,
                fontFamily: T.font,
                fontSize: 10,
                padding: '3px 9px',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                letterSpacing: '0.05em',
                opacity: isRunning ? 0.5 : 1,
              }}
            >
              {name} <span style={{ color: T.greenMid }}>({tickers.length})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Add ticker input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: T.greenMid, fontSize: 14 }}>{'>'}</span>
        <input
          data-no-drag type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && addTicker()}
          maxLength={10}
          placeholder="ADD TICKER"
          style={{
            flex: 1, background: T.bg, color: T.green,
            border: `1px solid ${T.greenDark}`, fontFamily: T.font,
            fontSize: 13, padding: '4px 8px', outline: 'none',
            caretColor: T.green, letterSpacing: '0.12em',
          }}
        />
        <button data-no-drag onClick={addTicker}
          disabled={!inputVal.trim() || watchlist.length >= 100}
          style={{
            background: T.bg, color: T.green,
            border: `1px solid ${T.green}`,
            fontFamily: T.font, fontSize: 11, padding: '4px 8px',
            cursor: 'pointer', letterSpacing: '0.04em',
          }}>
          + ADD
        </button>
      </div>

      {/* Watchlist chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 120, overflowY: 'auto' }}>
        {watchlist.map(t => {
          const st = assetData[t]?.status;
          const chipColor = st === 'ready' ? T.green : st === 'error' ? T.red : st === 'fetching' || st === 'analyzing' ? T.yellow : T.greenMid;
          return (
            <span key={t} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              border: `1px solid ${chipColor}`,
              padding: '2px 7px', fontSize: 11, color: chipColor,
              background: `${chipColor}10`,
            }}>
              {t}
              {st === 'fetching' || st === 'analyzing' ? <span style={{ fontSize: 9 }}>{dots}</span> : null}
              {st === 'error' ? <span style={{ fontSize: 9 }}>✗</span> : null}
              {st === 'ready' ? <span style={{ fontSize: 9 }}>✓</span> : null}
              <span
                data-no-drag
                onClick={() => removeTicker(t)}
                style={{ cursor: 'pointer', color: T.greenMid, marginLeft: 2, fontSize: 12, lineHeight: 1 }}
              >×</span>
            </span>
          );
        })}
        {watchlist.length === 0 && (
          <span style={{ color: T.greenDark, fontSize: 11 }}>Sin activos en watchlist</span>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${T.greenDark}` }} />

      {/* Analyze All button */}
      <button
        data-no-drag
        onClick={onAnalyzeAll}
        disabled={isRunning || watchlist.length === 0}
        style={{
          background: isRunning ? T.bg : T.bgHeader,
          color: '#ffffff',
          border: `1px solid ${T.bgHeader}`,
          fontFamily: T.font, fontSize: 12, padding: '8px 0',
          cursor: isRunning ? 'not-allowed' : 'pointer',
          letterSpacing: '0.08em', opacity: isRunning ? 0.7 : 1,
        }}
      >
        {isRunning ? `ANALIZANDO${dots}` : `▶ ANALIZAR TODO (${watchlist.length})`}
      </button>

      {/* Batch progress bar */}
      {(isRunning || batchProgress.total > 0) && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.greenMid, marginBottom: 3 }}>
            <span>PROGRESO GLOBAL</span>
            <span>{batchProgress.current}/{batchProgress.total} activos</span>
          </div>
          <div style={{ background: T.greenDark, height: 4, borderRadius: 2 }}>
            <div style={{
              background: T.green,
              height: 4, borderRadius: 2,
              width: batchProgress.total > 0 ? `${(batchProgress.current / batchProgress.total) * 100}%` : '0%',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: T.greenMid, marginTop: 4 }}>
            {readyCount > 0 && <span style={{ color: T.green }}>✓ {readyCount} listos</span>}
            {errorCount > 0 && <span style={{ color: T.red }}>✗ {errorCount} errores</span>}
          </div>
        </div>
      )}

      {/* Capacity indicator */}
      <div style={{ color: T.greenDark, fontSize: 10, textAlign: 'right' }}>
        {watchlist.length}/100 activos
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [PRC.DAT] — Price chart para activo seleccionado
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
        <div>{row('TICKER', ticker || '---')}</div>
        <div>{row('PRICE', '$---.--')}</div>
        <div style={{ marginTop: 12, color: T.greenDark }}>{'─'.repeat(40)}</div>
        <div style={{ marginTop: 8, color: T.greenDark, textAlign: 'center' }}>
          {ticker ? 'ANALIZANDO...' : 'SELECCIONA UN ACTIVO'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
            <XAxis dataKey="date"
              tick={{ fontSize: 9, fill: T.greenDark, fontFamily: T.font }}
              interval={Math.floor(data.length / 5)} tickLine={false}
              axisLine={{ stroke: T.greenDark }} />
            <Tooltip
              contentStyle={{ background: T.bgPanel, border: `1px solid ${T.greenDark}`, fontFamily: T.font, fontSize: 11 }}
              labelStyle={{ color: T.greenMid }} itemStyle={{ color: T.green }} />
            <Area type="monotone" dataKey="price"
              stroke={T.green} strokeWidth={1.5}
              fill="url(#greenGradient)" dot={false}
              activeDot={{ r: 3, fill: T.green, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [ANLYTCS] — Tabla multi-activo con ordenamiento y expansión
// ─────────────────────────────────────────────────────────────────────────────

function MultiAssetTable({ assetData, watchlist, profile, selectedAsset, onSelectAsset }) {
  const [sortKey, setSortKey] = React.useState('ticker');
  const [sortDir, setSortDir] = React.useState('asc');

  const signalColor = (s) => {
    const su = (s || '').toUpperCase();
    return su === 'BUY' ? T.green : su === 'SELL' ? T.red : T.yellow;
  };

  const riskColor = (r) => r === 'low' ? T.green : r === 'high' ? T.red : T.yellow;

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const rows = watchlist.map(ticker => {
    const d = assetData[ticker] || {};
    const orch = d.horizons?.[profile.time_horizon];
    return {
      ticker,
      status: d.status || 'idle',
      price: d.tech?.currentPrice ?? null,
      signal: orch?.final_action ?? null,
      confidence: orch?.confidence_score ?? null,
      pe: d.fund?.pe ?? null,
      rsi: d.tech?.rsi ?? null,
      risk: d.risk?.risk_level ?? null,
      maxWeight: d.risk?.max_weight ?? null,
      stopLoss: orch?.stop_loss ?? null,
      horizon: profile.time_horizon,
      error: d.error,
    };
  });

  const sortedRows = [...rows].sort((a, b) => {
    let aVal = a[sortKey];
    let bVal = b[sortKey];
    if (sortKey === 'ticker') { aVal = aVal || ''; bVal = bVal || ''; }
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const thStyle = (key) => ({
    color: sortKey === key ? T.green : T.greenMid,
    fontSize: 10, letterSpacing: '0.06em', padding: '4px 8px',
    cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'left',
    borderBottom: `1px solid ${T.greenDark}`,
    userSelect: 'none',
    background: sortKey === key ? `${T.green}08` : 'transparent',
  });

  const tdStyle = {
    padding: '5px 8px', fontSize: 11, borderBottom: `1px solid ${T.greenDark}10`,
    whiteSpace: 'nowrap', verticalAlign: 'middle',
  };

  const cols = [
    { key: 'ticker',    label: 'TICKER' },
    { key: 'price',     label: 'PRECIO' },
    { key: 'signal',    label: 'SEÑAL' },
    { key: 'confidence',label: 'CONFIANZA' },
    { key: 'pe',        label: 'P/E' },
    { key: 'rsi',       label: 'RSI' },
    { key: 'risk',      label: 'RIESGO' },
    { key: 'maxWeight', label: 'PESO MAX' },
    { key: 'stopLoss',  label: 'STOP LOSS' },
    { key: 'horizon',   label: 'HORIZONTE' },
  ];

  if (watchlist.length === 0) {
    return (
      <div style={{ color: T.greenDark, fontSize: 11, textAlign: 'center', paddingTop: 40 }}>
        Agregá activos a la watchlist y hacé click en ANALIZAR TODO
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.font }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} style={thStyle(c.key)} onClick={() => handleSort(c.key)}>
                {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(r => {
            const isSelected = selectedAsset === r.ticker;
            const asset = assetData[r.ticker];
            return (
              <React.Fragment key={r.ticker}>
                <tr
                  onClick={() => onSelectAsset(isSelected ? null : r.ticker)}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? `${T.green}10` : 'transparent',
                  }}
                >
                  {/* TICKER */}
                  <td style={{ ...tdStyle, fontWeight: 'bold', color: T.green }}>
                    {r.ticker}
                    {r.status === 'fetching' || r.status === 'analyzing'
                      ? <span style={{ color: T.yellow, marginLeft: 4, fontSize: 9 }}>●</span>
                      : null}
                  </td>
                  {/* PRECIO */}
                  <td style={{ ...tdStyle, color: T.green }}>
                    {r.price != null ? `$${r.price.toFixed(2)}` : '---'}
                  </td>
                  {/* SEÑAL */}
                  <td style={{ ...tdStyle }}>
                    {r.status === 'error'
                      ? <span style={{ color: T.red, fontSize: 10 }}>[ERR]</span>
                      : r.signal
                        ? <span style={{
                            color: '#fff', background: signalColor(r.signal),
                            padding: '1px 6px', fontSize: 10, letterSpacing: '0.06em',
                          }}>{r.signal.toUpperCase()}</span>
                        : <span style={{ color: T.greenDark }}>---</span>}
                  </td>
                  {/* CONFIANZA */}
                  <td style={{ ...tdStyle }}>
                    {r.confidence != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 60, height: 5, background: T.greenDark, borderRadius: 2 }}>
                          <div style={{
                            width: `${r.confidence}%`, height: 5, borderRadius: 2,
                            background: r.confidence >= 70 ? T.green : r.confidence >= 50 ? T.yellow : T.red,
                          }} />
                        </div>
                        <span style={{ color: T.greenMid, fontSize: 10 }}>{r.confidence}%</span>
                      </div>
                    ) : <span style={{ color: T.greenDark }}>---</span>}
                  </td>
                  {/* P/E */}
                  <td style={{ ...tdStyle, color: T.greenMid }}>
                    {r.pe != null ? r.pe.toFixed(1) : '---'}
                  </td>
                  {/* RSI */}
                  <td style={{ ...tdStyle, color: r.rsi != null ? (r.rsi > 70 ? T.red : r.rsi < 30 ? T.green : T.greenMid) : T.greenDark }}>
                    {r.rsi != null ? r.rsi.toFixed(1) : '---'}
                  </td>
                  {/* RIESGO */}
                  <td style={{ ...tdStyle }}>
                    {r.risk ? (
                      <span style={{
                        color: riskColor(r.risk), border: `1px solid ${riskColor(r.risk)}`,
                        padding: '1px 5px', fontSize: 10,
                      }}>
                        {r.risk.toUpperCase()}
                      </span>
                    ) : <span style={{ color: T.greenDark }}>---</span>}
                  </td>
                  {/* PESO MAX */}
                  <td style={{ ...tdStyle, color: T.greenMid }}>
                    {r.maxWeight != null ? `${r.maxWeight}%` : '---'}
                  </td>
                  {/* STOP LOSS */}
                  <td style={{ ...tdStyle, color: T.red }}>
                    {r.stopLoss != null ? `$${r.stopLoss.toFixed(2)}` : '---'}
                  </td>
                  {/* HORIZONTE */}
                  <td style={{ ...tdStyle, color: T.greenMid, fontSize: 10 }}>
                    {r.horizon.toUpperCase()}
                  </td>
                </tr>

                {/* FILA EXPANDIDA */}
                {isSelected && asset && (
                  <tr>
                    <td colSpan={10} style={{ padding: '0 0 8px 0', background: `${T.green}05` }}>
                      <AssetDetailExpanded asset={asset} ticker={r.ticker} profile={profile} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: AssetDetailExpanded — detalle inline en la tabla
// ─────────────────────────────────────────────────────────────────────────────

function AssetDetailExpanded({ asset, ticker, profile }) {
  const signalColor = (s) => (s === 'buy' || s === 'BUY') ? T.green : (s === 'sell' || s === 'SELL') ? T.red : T.yellow;

  const horizonLabels = {
    short:  'CORTO  (<3m)',
    medium: 'MEDIANO (3-12m)',
    long:   'LARGO  (1-3y)',
  };

  return (
    <div style={{
      padding: '10px 12px',
      borderLeft: `3px solid ${T.green}`,
      marginLeft: 8,
      display: 'flex', gap: 20, flexWrap: 'wrap',
    }}>
      {/* Agentes */}
      <div style={{ minWidth: 200 }}>
        <div style={{ color: T.greenMid, fontSize: 10, marginBottom: 6, letterSpacing: '0.08em' }}>── AGENT SIGNALS ──</div>
        {[
          asset.tech  && { label: 'TÉCNICO',     signal: asset.tech.signal,     conf: asset.tech.confidence,  just: asset.tech.justification },
          asset.fund  && { label: 'FUNDAMENTAL', signal: asset.fund.signal,     conf: asset.fund.confidence,  just: asset.fund.justification },
          asset.risk  && { label: 'RIESGO',      signal: asset.risk.risk_level, conf: null,                   just: asset.risk.justification },
        ].filter(Boolean).map(({ label, signal, conf, just }, i) => (
          <div key={i} style={{ marginBottom: 5 }}>
            <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
              <span style={{ color: T.greenMid, minWidth: 90 }}>{label}</span>
              <span style={{ color: signalColor(signal) }}>{(signal || '---').toUpperCase()}</span>
              {conf != null && <span style={{ color: T.greenDark, fontSize: 10 }}>{conf}%</span>}
            </div>
            {just && (
              <div style={{ color: T.greenDark, fontSize: 10, paddingLeft: 8 }}>
                {'> '}{just.slice(0, 80)}{just.length > 80 ? '…' : ''}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Tres horizontes */}
      <div style={{ flex: 1, minWidth: 400 }}>
        <div style={{ color: T.greenMid, fontSize: 10, marginBottom: 6, letterSpacing: '0.08em' }}>── ANÁLISIS POR HORIZONTE ──</div>
        <div style={{ display: 'flex', gap: 12 }}>
          {['short', 'medium', 'long'].map(h => {
            const orch = asset.horizons?.[h];
            const isPrimary = h === profile.time_horizon;
            const action = orch?.final_action?.toUpperCase() || '---';
            const actionColor = signalColor(action);
            return (
              <div key={h} style={{
                flex: 1, padding: '8px 10px',
                border: `1px solid ${isPrimary ? T.green : T.greenDark}`,
                background: isPrimary ? `${T.green}08` : 'transparent',
              }}>
                <div style={{ color: isPrimary ? T.green : T.greenMid, fontSize: 10, marginBottom: 4, letterSpacing: '0.05em' }}>
                  {horizonLabels[h]}{isPrimary ? ' ★' : ''}
                </div>
                <div style={{ color: actionColor, fontSize: 13, fontWeight: 'bold', marginBottom: 3 }}>{action}</div>
                <div style={{ color: T.greenDark, fontSize: 10 }}>
                  CONF: {orch?.confidence_score ?? '---'}%
                </div>
                <div style={{ color: T.greenDark, fontSize: 10 }}>
                  TARGET: {orch?.price_target ? `$${orch.price_target.toFixed(2)}` : '---'}
                </div>
                <div style={{ color: T.red, fontSize: 10 }}>
                  STOP: {orch?.stop_loss ? `$${orch.stop_loss.toFixed(2)}` : '---'}
                </div>
                {orch?._local && (
                  <div style={{ color: T.greenDark, fontSize: 9, marginTop: 2, fontStyle: 'italic' }}>local calc</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: ConfidenceRing
// ─────────────────────────────────────────────────────────────────────────────

function ConfidenceRing({ value }) {
  const [displayed, setDisplayed] = React.useState(0);
  React.useEffect(() => {
    const t = setTimeout(() => setDisplayed(value), 50);
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
      <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.greenDark} strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={offset}
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
// PANEL: [SIG.OUT] — Recomendación del activo seleccionado
// ─────────────────────────────────────────────────────────────────────────────

function SigOutPanel({ assetEntry, profile }) {
  const orch = assetEntry?.horizons?.[profile.time_horizon];
  const tech = assetEntry?.tech;
  const fund = assetEntry?.fund;
  const risk = assetEntry?.risk;

  if (!assetEntry || !orch) {
    return (
      <div style={{ color: T.greenDark, fontSize: 11 }}>
        <div style={{ marginBottom: 12 }}>SIGNAL......: AWAITING SELECTION</div>
        <ConfidenceRing value={0} />
        <div style={{ marginTop: 12, color: T.greenDark }}>
          Selecciona un activo de la tabla para ver el detalle.
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={{ color: T.greenDark, fontSize: 10, marginBottom: 4 }}>FINAL SIGNAL</div>
          <div style={{
            color: actionColor, fontSize: 22, fontWeight: 'bold',
            border: `1px solid ${actionColor}`, padding: '6px 16px',
            letterSpacing: '0.2em',
            boxShadow: `0 0 10px ${actionColor}40`,
          }}>▓ {action} ▓</div>
          {orch.contradiction_detected && (
            <div style={{ color: T.yellow, fontSize: 10, marginTop: 6 }}>⚠ CONTRADICTION DETECTED</div>
          )}
          {orch._local && (
            <div style={{ color: T.greenDark, fontSize: 9, marginTop: 4 }}>calculado localmente</div>
          )}
        </div>
        <div>
          <div style={{ color: T.greenDark, fontSize: 10, marginBottom: 4 }}>CONFIDENCE</div>
          <ConfidenceRing value={orch.confidence_score || 0} />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${T.greenDark}`, paddingTop: 8 }}>
        {[
          row('PRICE TARGET', orch.price_target ? `$${orch.price_target.toFixed(2)}${pctTarget ? ` (${pctTarget > 0 ? '+' : ''}${pctTarget}%)` : ''}` : '---'),
          row('STOP LOSS',   orch.stop_loss   ? `$${orch.stop_loss.toFixed(2)}${pctStop ? ` (${pctStop}%)` : ''}` : '---'),
          row('PORTFOLIO',   `${orch.portfolio_weight}% = $${capitalAlloc.toLocaleString('en', { maximumFractionDigits: 0 })}`),
          row('HORIZONTE',   (orch.time_horizon || profile.time_horizon).toUpperCase()),
        ].map((line, i) => (
          <div key={i} style={{ color: T.green, whiteSpace: 'pre', marginBottom: 3 }}>{line}</div>
        ))}
      </div>

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

      {/* Agent signals */}
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

// ─────────────────────────────────────────────────────────────────────────────
// PANEL: [PRT.SUM] — Portfolio Summary
// ─────────────────────────────────────────────────────────────────────────────

function PortfolioSummaryPanel({ assetData, watchlist, profile }) {
  const readyAssets = watchlist
    .map(ticker => {
      const d = assetData[ticker];
      if (!d || d.status !== 'ready') return null;
      const orch = d.horizons?.[profile.time_horizon];
      if (!orch) return null;
      return {
        ticker,
        sector:     d.fund?.sector || 'Unknown',
        weight:     orch.portfolio_weight || 0,
        maxWeight:  d.risk?.max_weight || 8,
        action:     orch.final_action,
      };
    })
    .filter(Boolean);

  // Only include BUY recommendations in portfolio
  const buyAssets = readyAssets.filter(a => a.action === 'buy');

  // Normalize weights so they don't exceed 100% total
  const rawTotal = buyAssets.reduce((s, a) => s + a.weight, 0);
  const scaleFactor = rawTotal > 100 ? 100 / rawTotal : 1;

  const allocationRows = buyAssets.map(a => ({
    ...a,
    allocatedWeight: +(a.weight * scaleFactor).toFixed(2),
    allocatedAmount: +(profile.capital * (a.weight * scaleFactor) / 100).toFixed(0),
  }));

  const totalWeight = allocationRows.reduce((s, a) => s + a.allocatedWeight, 0);
  const totalAmount = allocationRows.reduce((s, a) => s + a.allocatedAmount, 0);
  const cashRemaining = profile.capital - totalAmount;

  // Sector concentration
  const sectorMap = {};
  allocationRows.forEach(a => {
    sectorMap[a.sector] = (sectorMap[a.sector] || 0) + a.allocatedWeight;
  });
  const maxSectorConc = Math.max(0, ...Object.values(sectorMap));
  const maxSector = Object.entries(sectorMap).sort((a, b) => b[1] - a[1])[0];

  // Alerts
  const alerts = [];
  if (totalWeight > 100) alerts.push({ type: 'error', msg: `Suma de pesos (${totalWeight.toFixed(1)}%) supera 100%` });
  if (maxSectorConc > 40 && maxSector) alerts.push({ type: 'warn', msg: `Concentración sectorial alta: ${maxSector[0]} (${maxSector[1].toFixed(1)}%)` });
  allocationRows.forEach(a => {
    if (a.allocatedWeight > a.maxWeight) alerts.push({ type: 'warn', msg: `${a.ticker}: ${a.allocatedWeight.toFixed(1)}% supera max_weight (${a.maxWeight}%)` });
  });

  const thStyle = {
    color: T.greenMid, fontSize: 10, letterSpacing: '0.06em', padding: '3px 8px',
    borderBottom: `1px solid ${T.greenDark}`, textAlign: 'left',
  };
  const tdStyle = { padding: '4px 8px', fontSize: 11, borderBottom: `1px solid ${T.greenDark}10` };

  if (readyAssets.length === 0) {
    return (
      <div style={{ color: T.greenDark, fontSize: 11, textAlign: 'center', paddingTop: 30 }}>
        Ejecuta ANALIZAR TODO para ver el resumen de cartera.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 11 }}>
      {/* Alerts */}
      {alerts.map((al, i) => (
        <div key={i} style={{
          color: al.type === 'error' ? T.red : T.yellow,
          border: `1px solid ${al.type === 'error' ? T.red : T.yellow}`,
          padding: '3px 8px', fontSize: 10,
        }}>
          ⚠ {al.msg}
        </div>
      ))}

      {/* Allocation table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.font }}>
        <thead>
          <tr>
            <th style={thStyle}>TICKER</th>
            <th style={thStyle}>SECTOR</th>
            <th style={thStyle}>% CARTERA</th>
            <th style={thStyle}>MONTO ($)</th>
          </tr>
        </thead>
        <tbody>
          {allocationRows.map(a => (
            <tr key={a.ticker}>
              <td style={{ ...tdStyle, color: T.green, fontWeight: 'bold' }}>{a.ticker}</td>
              <td style={{ ...tdStyle, color: T.greenMid, fontSize: 10 }}>{a.sector || 'N/A'}</td>
              <td style={{ ...tdStyle, color: T.green }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 40, height: 4, background: T.greenDark, borderRadius: 2 }}>
                    <div style={{ width: `${Math.min(100, a.allocatedWeight)}%`, height: 4, background: T.green, borderRadius: 2 }} />
                  </div>
                  <span>{a.allocatedWeight}%</span>
                  {a.allocatedWeight > a.maxWeight && <span style={{ color: T.yellow, fontSize: 9 }}>⚠</span>}
                </div>
              </td>
              <td style={{ ...tdStyle, color: T.green }}>
                ${a.allocatedAmount.toLocaleString('en', { maximumFractionDigits: 0 })}
              </td>
            </tr>
          ))}

          {/* Total row */}
          <tr style={{ borderTop: `1px solid ${T.greenDark}` }}>
            <td style={{ ...tdStyle, color: T.greenMid, fontWeight: 'bold' }} colSpan={2}>TOTAL INVERTIDO</td>
            <td style={{ ...tdStyle, color: T.green, fontWeight: 'bold' }}>{totalWeight.toFixed(1)}%</td>
            <td style={{ ...tdStyle, color: T.green, fontWeight: 'bold' }}>
              ${totalAmount.toLocaleString('en', { maximumFractionDigits: 0 })}
            </td>
          </tr>
          <tr>
            <td style={{ ...tdStyle, color: T.greenMid }} colSpan={2}>CASH RESTANTE</td>
            <td style={{ ...tdStyle, color: cashRemaining < 0 ? T.red : T.greenMid }}>
              {(100 - totalWeight).toFixed(1)}%
            </td>
            <td style={{ ...tdStyle, color: cashRemaining < 0 ? T.red : T.greenMid }}>
              ${cashRemaining.toLocaleString('en', { maximumFractionDigits: 0 })}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Sector concentration */}
      {Object.keys(sectorMap).length > 0 && (
        <div>
          <div style={{ color: T.greenMid, fontSize: 10, marginBottom: 4, letterSpacing: '0.06em' }}>── CONCENTRACIÓN SECTORIAL ──</div>
          {Object.entries(sectorMap).sort((a, b) => b[1] - a[1]).map(([sec, w]) => (
            <div key={sec} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ color: T.greenMid, fontSize: 10, minWidth: 100 }}>{sec.slice(0, 12)}</span>
              <div style={{ flex: 1, height: 4, background: T.greenDark, borderRadius: 2 }}>
                <div style={{
                  width: `${Math.min(100, w)}%`, height: 4, borderRadius: 2,
                  background: w > 40 ? T.yellow : T.green,
                }} />
              </div>
              <span style={{ color: w > 40 ? T.yellow : T.greenMid, fontSize: 10, minWidth: 36 }}>
                {w.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT — InvestmentAdvisor v3.0
// ═══════════════════════════════════════════════════════════════════════════════

export default function InvestmentAdvisor() {
  // ── Investor profile ───────────────────────────────────────────────────────
  const [profile, setProfile] = React.useState({
    capital: 50000, risk_profile: 'moderate',
    time_horizon: 'medium', preferred_sectors: [],
  });

  // ── Watchlist ──────────────────────────────────────────────────────────────
  const [watchlist, setWatchlist] = React.useState(DEFAULT_WATCHLIST);

  // ── Multi-asset data: { [ticker]: { status, tech, fund, risk, horizons, error } }
  const [assetData, setAssetData] = React.useState({});

  // ── Batch processing ───────────────────────────────────────────────────────
  const [batchProgress, setBatchProgress] = React.useState({ current: 0, total: 0, running: false });
  const isRunningRef = React.useRef(false);

  // ── Selected asset for detail panels ──────────────────────────────────────
  const [selectedAsset, setSelectedAsset] = React.useState(null);

  // ── Auto-refresh ───────────────────────────────────────────────────────────
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [countdown, setCountdown] = React.useState(0);
  const countdownRef = React.useRef(null);
  const analyzeAllRef = React.useRef(null);

  // ── Panel drag system ──────────────────────────────────────────────────────
  const { panels, onTitleMouseDown, toggleMinimize, toggleMaximize } = usePanels();

  // ── Mobile detection ───────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 900);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // ── updateAsset helper ─────────────────────────────────────────────────────
  const updateAsset = React.useCallback((ticker, updates) => {
    setAssetData(prev => ({
      ...prev,
      [ticker]: { ...(prev[ticker] || {}), ...updates },
    }));
  }, []);

  // ── processAsset: runs the full 4-agent pipeline for one ticker ────────────
  const processAsset = React.useCallback(async (ticker, prof) => {
    try {
      updateAsset(ticker, { status: 'fetching', error: null });

      const [techOutcome, fundOutcome] = await Promise.allSettled([
        runTechnicalAgent(ticker, () => {}),
        runFundamentalAgent(ticker, () => {}),
      ]);

      const tech = techOutcome.status === 'fulfilled' ? techOutcome.value : null;
      const fund = fundOutcome.status === 'fulfilled' ? fundOutcome.value : null;

      if (!tech && !fund) {
        const errMsg = techOutcome.reason?.message || fundOutcome.reason?.message || 'Error de datos';
        updateAsset(ticker, { status: 'error', error: errMsg });
        return;
      }

      updateAsset(ticker, { status: 'analyzing', tech, fund });

      let risk = null;
      try {
        risk = runRiskAgent(tech, fund, prof);
      } catch (_) {}

      // Primary horizon via Claude
      let primaryOrch = null;
      try {
        primaryOrch = await runOrchestratorAgent(
          tech  || { error: techOutcome.reason?.message },
          fund  || { error: fundOutcome.reason?.message },
          risk,
          prof,
          () => {}
        );
      } catch (_) {
        // Fallback to local computation
        primaryOrch = computeHorizonLocally(tech, fund, risk, prof.time_horizon);
      }

      // Compute all three horizons (non-primary ones computed locally)
      const horizons = {};
      ['short', 'medium', 'long'].forEach(h => {
        horizons[h] = (h === prof.time_horizon && primaryOrch)
          ? primaryOrch
          : computeHorizonLocally(tech, fund, risk, h);
      });

      updateAsset(ticker, { status: 'ready', tech, fund, risk, horizons, error: null });
    } catch (e) {
      updateAsset(ticker, { status: 'error', error: e?.message || 'Error desconocido' });
    }
  }, [updateAsset]);

  // ── analyzeAll: process entire watchlist in batches of 5 ──────────────────
  const analyzeAll = React.useCallback(async (wl, prof) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    const list = wl || watchlist;
    const p    = prof || profile;

    // Reset all statuses
    const initial = {};
    list.forEach(t => { initial[t] = { status: 'waiting', tech: null, fund: null, risk: null, horizons: null, error: null }; });
    setAssetData(initial);
    setBatchProgress({ current: 0, total: list.length, running: true });

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(ticker => processAsset(ticker, p)));
      const done = Math.min(i + BATCH_SIZE, list.length);
      setBatchProgress(prev => ({ ...prev, current: done }));
      if (i + BATCH_SIZE < list.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setBatchProgress(prev => ({ ...prev, running: false }));
    isRunningRef.current = false;
  }, [watchlist, profile, processAsset]);

  // Keep ref updated to avoid stale closure in countdown
  analyzeAllRef.current = () => analyzeAll(watchlist, profile);

  // ── Auto-refresh countdown ─────────────────────────────────────────────────
  React.useEffect(() => {
    clearInterval(countdownRef.current);
    if (!autoRefresh) {
      setCountdown(0);
      return;
    }
    setCountdown(REFRESH_INTERVAL_SECS);
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          analyzeAllRef.current?.();
          return REFRESH_INTERVAL_SECS;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [autoRefresh]);

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

  const selectedAssetEntry = selectedAsset ? assetData[selectedAsset] : null;
  const selectedTech       = selectedAssetEntry?.tech;

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
      <GlobalHeader
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh(v => !v)}
        countdown={countdown}
        batchProgress={batchProgress}
      />

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>

        <TerminalPanel {...panelProps('syscfg')} title="[SYS.CFG] INVESTOR PROFILE">
          <SysCfgPanel profile={profile} setProfile={setProfile} />
        </TerminalPanel>

        <TerminalPanel {...panelProps('mktin')} title="[MKT.IN] WATCHLIST">
          <WatchlistPanel
            watchlist={watchlist}
            setWatchlist={setWatchlist}
            isRunning={batchProgress.running}
            onAnalyzeAll={() => analyzeAll(watchlist, profile)}
            batchProgress={batchProgress}
            assetData={assetData}
          />
        </TerminalPanel>

        <TerminalPanel {...panelProps('prcdat')} title={`[PRC.DAT] ${selectedAsset || 'PRICE DATA'}`}>
          <PrcDatPanel tech={selectedTech} ticker={selectedAsset || ''} />
        </TerminalPanel>

        <TerminalPanel {...panelProps('anlytcs')} title="[ANLYTCS] MULTI-ASSET TABLE">
          <MultiAssetTable
            assetData={assetData}
            watchlist={watchlist}
            profile={profile}
            selectedAsset={selectedAsset}
            onSelectAsset={setSelectedAsset}
          />
        </TerminalPanel>

        <TerminalPanel {...panelProps('sigout')} title={`[SIG.OUT] ${selectedAsset ? `SIGNAL — ${selectedAsset}` : 'SIGNAL OUTPUT'}`}>
          <SigOutPanel
            assetEntry={selectedAssetEntry}
            profile={profile}
          />
        </TerminalPanel>

        <TerminalPanel {...panelProps('prtsum')} title="[PRT.SUM] PORTFOLIO SUMMARY">
          <PortfolioSummaryPanel
            assetData={assetData}
            watchlist={watchlist}
            profile={profile}
          />
        </TerminalPanel>

      </div>
    </div>
  );
}
