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
  LineChart,
  Line,
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
  bg:       '#000000',
  bgPanel:  '#050f05',
  bgHeader: '#001a00',
  green:    '#00ff41',
  greenMid: '#00cc33',
  greenDark:'#003311',
  greenGlow:'rgba(0,255,65,0.12)',
  red:      '#ff3333',
  yellow:   '#ffcc00',
  font:     "'Courier New', Courier, monospace",
};

const SCANLINES = 'repeating-linear-gradient(transparent 0px, transparent 3px, rgba(0,255,65,0.025) 3px, rgba(0,255,65,0.025) 4px)';

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

