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
// COMPONENTES DE UI
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_CFG = {
  idle:      { label: 'Inactivo',         color: 'text-gray-500',   dot: 'bg-gray-600',    pulse: false },
  waiting:   { label: 'Esperando',        color: 'text-gray-400',   dot: 'bg-gray-500',    pulse: false },
  fetching:  { label: 'Obteniendo datos', color: 'text-blue-400',   dot: 'bg-blue-400',    pulse: true  },
  analyzing: { label: 'Analizando',       color: 'text-yellow-400', dot: 'bg-yellow-400',  pulse: true  },
  ready:     { label: 'Listo',            color: 'text-green-400',  dot: 'bg-green-500',   pulse: false },
  error:     { label: 'Error',            color: 'text-red-400',    dot: 'bg-red-500',     pulse: false },
};

function StatusIndicator({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.idle;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
      <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
    </div>
  );
}

function SignalBadge({ signal, small = false }) {
  const cfg = {
    buy:  { label: 'COMPRAR', bg: 'bg-green-600',  text: 'text-white' },
    sell: { label: 'VENDER',  bg: 'bg-red-600',    text: 'text-white' },
    hold: { label: 'MANTENER',bg: 'bg-yellow-500', text: 'text-black' },
  };
  const c = cfg[signal] || cfg.hold;
  return (
    <span className={`${c.bg} ${c.text} rounded font-bold uppercase tracking-wide ${small ? 'px-2 py-0.5 text-xs' : 'px-5 py-2 text-xl'}`}>
      {c.label}
    </span>
  );
}

function RiskBadge({ level }) {
  const cfg = {
    low:      { label: 'BAJO',     bg: 'bg-green-900',  text: 'text-green-300' },
    moderate: { label: 'MODERADO', bg: 'bg-yellow-900', text: 'text-yellow-300' },
    high:     { label: 'ALTO',     bg: 'bg-red-900',    text: 'text-red-300' },
  };
  const c = cfg[level] || cfg.moderate;
  return (
    <span className={`${c.bg} ${c.text} rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide`}>
      {c.label}
    </span>
  );
}

function AgentCard({ name, icon, status, result, error }) {
  const signal     = result?.signal ?? result?.final_action;
  const confidence = result?.confidence ?? result?.confidence_score;
  const riskLevel  = result?.risk_level;

  const borderClass =
    status === 'ready'   ? 'border-green-700/40' :
    status === 'error'   ? 'border-red-700/40'   :
    ['fetching','analyzing'].includes(status) ? 'border-blue-700/40' :
    'border-gray-800';

  return (
    <div className={`bg-gray-900 border rounded-xl p-3.5 transition-colors ${borderClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{icon}</span>
          <span className="text-sm font-semibold text-gray-200">{name}</span>
        </div>
        <StatusIndicator status={status} />
      </div>
      {error && (
        <p className="text-xs text-red-400 mt-2 leading-relaxed">{error}</p>
      )}
      {status === 'ready' && result && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {signal     && <SignalBadge signal={signal} small />}
          {riskLevel && !signal && <RiskBadge level={riskLevel} />}
          {confidence != null && (
            <span className="text-xs text-gray-400">{confidence}% confianza</span>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidenceRing({ value, size = 128 }) {
  const strokeWidth = 10;
  const r     = (size - strokeWidth) / 2;
  const circ  = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const color = value >= 70 ? '#22c55e' : value >= 50 ? '#eab308' : '#ef4444';

  return (
    <div className="relative flex items-center justify-center flex-shrink-0"
         style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke="#1f2937" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={color} strokeWidth={strokeWidth}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1)' }} />
      </svg>
      <div className="relative z-10 text-center">
        <div className="text-2xl font-bold leading-none" style={{ color }}>{value}</div>
        <div className="text-xs text-gray-400 mt-0.5">% conf.</div>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs shadow-lg">
      <p className="text-gray-400">{payload[0]?.payload?.date}</p>
      <p className="text-blue-300 font-semibold">${payload[0]?.value?.toFixed(2)}</p>
    </div>
  );
}

function PriceChart({ data, ticker, currentPrice }) {
  const prices = data.map(d => d.price).filter(Boolean);
  const minP   = Math.min(...prices);
  const maxP   = Math.max(...prices);
  const change = prices.length > 1 ? ((prices[prices.length - 1] / prices[0] - 1) * 100) : 0;
  const isUp   = change >= 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">{ticker} — Últimos 60 días</h3>
          <p className="text-xs text-gray-500 mt-0.5">Precio de cierre diario</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-white">${currentPrice?.toFixed(2)}</div>
          <div className={`text-xs font-medium mt-0.5 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            {isUp ? '+' : ''}{change.toFixed(2)}% (60d)
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#6b7280' }}
            interval={Math.floor(data.length / 5)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="price"
            stroke={isUp ? '#22c55e' : '#ef4444'}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: isUp ? '#22c55e' : '#ef4444', strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProfilePanel({ profile, setProfile }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h2 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-widest">
        Perfil del Inversor
      </h2>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Capital disponible (USD)</label>
          <input
            type="number"
            min={0}
            value={profile.capital}
            onChange={e => setProfile(p => ({ ...p, capital: parseFloat(e.target.value) || 0 }))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Perfil de riesgo</label>
          <select
            value={profile.risk_profile}
            onChange={e => setProfile(p => ({ ...p, risk_profile: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-blue-500"
          >
            <option value="conservative">Conservador</option>
            <option value="moderate">Moderado</option>
            <option value="aggressive">Agresivo</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Horizonte temporal</label>
          <select
            value={profile.time_horizon}
            onChange={e => setProfile(p => ({ ...p, time_horizon: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-blue-500"
          >
            <option value="short">Corto plazo (&lt;1 año)</option>
            <option value="medium">Mediano plazo (1-3 años)</option>
            <option value="long">Largo plazo (&gt;3 años)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">
            Sectores preferidos <span className="text-gray-600">(separados por coma)</span>
          </label>
          <input
            type="text"
            value={profile.preferred_sectors.join(', ')}
            onChange={e => setProfile(p => ({
              ...p,
              preferred_sectors: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
            }))}
            placeholder="Technology, Healthcare, Energy..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                       placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  );
}

function TickerInput({ ticker, setTicker, isAnalyzing, onAnalyze, autoRefresh, setAutoRefresh }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h2 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-widest">
        Ticker a Analizar
      </h2>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && !isAnalyzing && onAnalyze()}
          placeholder="AAPL, MSFT, GOOGL..."
          maxLength={10}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono
                     text-white uppercase placeholder:normal-case placeholder:text-gray-600
                     focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
        />
        <button
          onClick={onAnalyze}
          disabled={isAnalyzing || !ticker.trim()}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
            isAnalyzing || !ticker.trim()
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-lg shadow-blue-900/30'
          }`}
        >
          {isAnalyzing ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-gray-500 border-t-gray-300 animate-spin" />
              Analizando
            </span>
          ) : 'Analizar'}
        </button>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-300 font-medium">Auto-refresh</p>
          <p className="text-xs text-gray-600">Repite el análisis cada 15 min</p>
        </div>
        <button
          onClick={() => setAutoRefresh(v => !v)}
          aria-label="Toggle auto-refresh"
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            autoRefresh ? 'bg-blue-600' : 'bg-gray-700'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            autoRefresh ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>
    </div>
  );
}

function AgentCards({ agentStates, errors, agentResults }) {
  const agents = [
    { key: 'technical',    name: 'Análisis Técnico',      icon: '📈' },
    { key: 'fundamental',  name: 'Análisis Fundamental',  icon: '📊' },
    { key: 'risk',         name: 'Gestión de Riesgo',     icon: '🛡️' },
    { key: 'orchestrator', name: 'Orquestador Claude',    icon: '🤖' },
  ];
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
        Estado de Agentes
      </h2>
      {agents.map(({ key, name, icon }) => (
        <AgentCard
          key={key}
          name={name}
          icon={icon}
          status={agentStates[key]}
          result={agentResults[key]}
          error={errors[key]}
        />
      ))}
    </div>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-800/70 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-semibold text-gray-200 font-mono">{value}</span>
    </div>
  );
}

function AgentBreakdown({ label, icon, result, error }) {
  if (!result && !error) return null;
  const signal     = result?.signal;
  const confidence = result?.confidence;
  const riskLevel  = result?.risk_level;

  return (
    <div className="bg-gray-800/40 rounded-xl p-3.5 border border-gray-800/60">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-gray-200">{label}</span>
        {signal     && <SignalBadge signal={signal} small />}
        {riskLevel && !signal && <RiskBadge level={riskLevel} />}
        {confidence != null && (
          <span className="text-xs text-gray-500 ml-auto">{confidence}% conf.</span>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-400 leading-relaxed">{error}</p>
      )}
      {result?.justification && (
        <p className="text-xs text-gray-400 leading-relaxed">{result.justification}</p>
      )}
    </div>
  );
}

function ResultsPanel({ orch, tech, fund, risk, profile, errors }) {
  const capitalAlloc = profile.capital * (orch.portfolio_weight / 100);
  const pctFromTarget = tech?.currentPrice && orch.price_target
    ? ((orch.price_target / tech.currentPrice - 1) * 100).toFixed(1)
    : null;
  const pctFromStop = tech?.currentPrice && orch.stop_loss
    ? ((orch.stop_loss / tech.currentPrice - 1) * 100).toFixed(1)
    : null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Recomendación Final</h2>
        <span className="text-xs text-gray-600">{new Date().toLocaleTimeString('es')}</span>
      </div>

      {/* Action + confidence + allocation */}
      <div className="flex items-start gap-5 flex-wrap">
        {/* Signal + contradiction */}
        <div className="flex flex-col gap-2">
          <SignalBadge signal={orch.final_action} />
          {orch.contradiction_detected && (
            <div className="flex items-center gap-1.5 bg-orange-900/30 border border-orange-700/40 rounded-lg px-2.5 py-1.5">
              <span className="text-orange-400 text-xs">⚠</span>
              <span className="text-orange-300 text-xs font-medium">Contradicción entre agentes</span>
            </div>
          )}
        </div>

        {/* Confidence ring */}
        <ConfidenceRing value={orch.confidence_score} />

        {/* Allocation */}
        <div className="flex-1 min-w-[160px] bg-gray-800/50 rounded-xl p-3.5 border border-gray-700/40">
          <p className="text-xs text-gray-400 mb-1">Peso recomendado en cartera</p>
          <p className="text-2xl font-bold text-white">{orch.portfolio_weight}%</p>
          <p className="text-sm text-blue-400 font-medium mt-0.5">
            ${capitalAlloc.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">
            de tu capital (${profile.capital.toLocaleString('es-AR')})
          </p>
          {risk?.max_weight && (
            <p className="text-xs text-gray-500 mt-1.5 border-t border-gray-700/60 pt-1.5">
              Límite agente de riesgo: {risk.max_weight}%
            </p>
          )}
        </div>
      </div>

      {/* Price targets */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-900/15 border border-green-800/40 rounded-xl p-3.5">
          <p className="text-xs text-gray-400 mb-1">Precio Objetivo</p>
          <p className="text-xl font-bold text-green-400 font-mono">
            {orch.price_target ? `$${orch.price_target.toFixed(2)}` : 'N/A'}
          </p>
          {pctFromTarget && (
            <p className={`text-xs mt-0.5 ${parseFloat(pctFromTarget) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {parseFloat(pctFromTarget) >= 0 ? '+' : ''}{pctFromTarget}% vs. precio actual
            </p>
          )}
        </div>
        <div className="bg-red-900/15 border border-red-800/40 rounded-xl p-3.5">
          <p className="text-xs text-gray-400 mb-1">Stop Loss</p>
          <p className="text-xl font-bold text-red-400 font-mono">
            {orch.stop_loss ? `$${orch.stop_loss.toFixed(2)}` : 'N/A'}
          </p>
          {pctFromStop && (
            <p className="text-xs text-red-600 mt-0.5">
              {pctFromStop}% vs. precio actual
            </p>
          )}
        </div>
      </div>

      {/* Multicriteria justification */}
      {orch.justification_multicriteria && (
        <div className="bg-blue-900/10 border border-blue-800/30 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-300 mb-1.5 uppercase tracking-wide">
            Análisis Multicriteria — Orquestador
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">
            {orch.justification_multicriteria}
          </p>
        </div>
      )}

      {/* Technical + Fundamental metrics grid */}
      {(tech || fund) && (
        <div className="grid grid-cols-2 gap-3">
          {tech && (
            <div className="bg-gray-800/30 rounded-xl p-3.5 border border-gray-800/50">
              <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                Indicadores Técnicos
              </p>
              <MetricRow label="RSI (14)"   value={tech.rsi} />
              <MetricRow label="SMA 50"     value={`$${tech.sma50}`} />
              <MetricRow label="SMA 200"    value={`$${tech.sma200}`} />
              <MetricRow label="MACD"       value={tech.macd} />
              <MetricRow label="Tendencia"  value={tech.sma50 > tech.sma200 ? '↑ Alcista' : '↓ Bajista'} />
            </div>
          )}
          {fund && (
            <div className="bg-gray-800/30 rounded-xl p-3.5 border border-gray-800/50">
              <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                Métricas Fundamentales
              </p>
              <MetricRow label="P/E Ratio"      value={fund.pe || '—'} />
              <MetricRow label="ROE"            value={`${fund.roe}%`} />
              <MetricRow label="PEG Ratio"      value={fund.peg || '—'} />
              <MetricRow label="Crecim. EPS"    value={`${fund.eps_growth}%`} />
              <MetricRow label="Quality Score"  value={`${fund.quality_score}/100`} />
            </div>
          )}
        </div>
      )}

      {/* Risk metrics */}
      {risk && (
        <div className="bg-gray-800/30 rounded-xl p-3.5 border border-gray-800/50">
          <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">
            Métricas de Riesgo
          </p>
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { label: 'Nivel',           value: risk.risk_level.toUpperCase(),
                color: risk.risk_level === 'low' ? 'text-green-400' : risk.risk_level === 'high' ? 'text-red-400' : 'text-yellow-400' },
              { label: 'Volatilidad 30d', value: `${risk.volatility_30d}%`,      color: 'text-white' },
              { label: 'VaR (95%/día)',   value: `$${risk.var_95}`,              color: 'text-white' },
              { label: 'Beta',            value: risk.beta,                      color: 'text-white' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent breakdowns */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Desglose por Agente
        </p>
        <AgentBreakdown label="Análisis Técnico"     icon="📈" result={tech} error={errors?.technical} />
        <AgentBreakdown label="Análisis Fundamental" icon="📊" result={fund} error={errors?.fundamental} />
        <AgentBreakdown label="Gestión de Riesgo"    icon="🛡️" result={risk} error={errors?.risk} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 flex flex-col items-center justify-center text-center">
      <div className="text-5xl mb-4 opacity-60">📊</div>
      <p className="text-gray-300 font-semibold">Ingresa un ticker y haz click en Analizar</p>
      <p className="text-gray-600 text-sm mt-2 max-w-xs leading-relaxed">
        El sistema ejecutará 4 agentes especializados en paralelo y entregará
        una recomendación de inversión consolidada.
      </p>
      <div className="mt-5 grid grid-cols-4 gap-3 text-xs text-gray-600">
        {['📈 Técnico', '📊 Fundamental', '🛡️ Riesgo', '🤖 Claude'].map(a => (
          <div key={a} className="bg-gray-800/50 rounded-lg px-2.5 py-1.5 border border-gray-800">{a}</div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function InvestmentAdvisor() {
  const [profile, setProfile] = useState({
    capital: 50000,
    risk_profile: 'moderate',
    time_horizon: 'medium',
    preferred_sectors: [],
  });
  const [ticker, setTicker]       = useState('AAPL');
  const [isAnalyzing, setAnalyzing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [agentStates, setAgentStates] = useState({
    technical: 'idle', fundamental: 'idle', risk: 'idle', orchestrator: 'idle',
  });
  const [agentResults, setAgentResults] = useState({
    technical: null, fundamental: null, risk: null, orchestrator: null,
  });
  const [errors, setErrors] = useState({});

  const isAnalyzingRef  = useRef(false);
  const autoRefreshRef  = useRef(null);

  const setAgentState = useCallback((agent, status) => {
    setAgentStates(prev => ({ ...prev, [agent]: status }));
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!ticker.trim() || isAnalyzingRef.current) return;

    isAnalyzingRef.current = true;
    setAnalyzing(true);
    setErrors({});
    setAgentResults({ technical: null, fundamental: null, risk: null, orchestrator: null });
    setAgentStates({ technical: 'fetching', fundamental: 'fetching', risk: 'waiting', orchestrator: 'waiting' });

    const sym = ticker.trim().toUpperCase();
    let techResult = null;
    let fundResult = null;
    let riskResult = null;
    const newErrors = {};

    // ── Agentes 1 y 2 en paralelo ──────────────────────────────────────────
    const [techOutcome, fundOutcome] = await Promise.allSettled([
      runTechnicalAgent(sym,   s => setAgentState('technical',   s)),
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

    // ── Agente 3: Riesgo (determinístico, usa datos de agentes 1 y 2) ──────
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

    // ── Agente 4: Orquestador Claude (secuencial) ──────────────────────────
    if (techResult || fundResult) {
      setAgentState('orchestrator', 'fetching');
      try {
        const orchResult = await runOrchestratorAgent(
          techResult  || { error: newErrors.technical   },
          fundResult  || { error: newErrors.fundamental },
          riskResult  || { error: newErrors.risk        },
          profile,
          s => setAgentState('orchestrator', s),
        );
        setAgentResults(p => ({ ...p, orchestrator: orchResult }));
        setAgentState('orchestrator', 'ready');
      } catch (e) {
        setErrors(p => ({ ...p, orchestrator: e?.message || 'Error en orquestador' }));
        setAgentState('orchestrator', 'error');
      }
    } else {
      setErrors(p => ({ ...p, orchestrator: 'Datos insuficientes para orquestar (agentes 1 y 2 fallaron)' }));
      setAgentState('orchestrator', 'error');
    }

    isAnalyzingRef.current = false;
    setAnalyzing(false);
  }, [ticker, profile, setAgentState]);

  // ── Auto-refresh cada 15 minutos ──────────────────────────────────────────
  useEffect(() => {
    clearInterval(autoRefreshRef.current);
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(runAnalysis, 15 * 60 * 1000);
    }
    return () => clearInterval(autoRefreshRef.current);
  }, [autoRefresh, runAnalysis]);

  const orch = agentResults.orchestrator;
  const tech = agentResults.technical;
  const fund = agentResults.fundamental;
  const risk = agentResults.risk;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-start justify-between max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            <span className="text-blue-400">AI</span> Investment Advisor
          </h1>
          <p className="text-gray-500 text-xs mt-1">
            Plataforma multi-agente · 4 agentes especializados · Powered by Claude
          </p>
        </div>
        {autoRefresh && (
          <div className="flex items-center gap-2 bg-blue-950/60 border border-blue-700/40 rounded-lg px-3 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-xs text-blue-300 font-medium">Auto-refresh · 15 min</span>
          </div>
        )}
      </div>

      {/* ── Layout ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-7xl mx-auto">

        {/* Panel izquierdo */}
        <div className="space-y-4">
          <ProfilePanel profile={profile} setProfile={setProfile} />
          <TickerInput
            ticker={ticker}
            setTicker={setTicker}
            isAnalyzing={isAnalyzing}
            onAnalyze={runAnalysis}
            autoRefresh={autoRefresh}
            setAutoRefresh={setAutoRefresh}
          />
          <AgentCards
            agentStates={agentStates}
            errors={errors}
            agentResults={agentResults}
          />
        </div>

        {/* Panel derecho */}
        <div className="lg:col-span-2 space-y-4">
          {tech?.priceHistory?.length > 0 && (
            <PriceChart
              data={tech.priceHistory}
              ticker={ticker.trim().toUpperCase()}
              currentPrice={tech.currentPrice}
            />
          )}

          {orch ? (
            <ResultsPanel
              orch={orch}
              tech={tech}
              fund={fund}
              risk={risk}
              profile={profile}
              errors={errors}
            />
          ) : errors.orchestrator ? (
            <div className="bg-gray-900 border border-red-800/50 rounded-xl p-5">
              <p className="text-red-400 font-semibold text-sm mb-1">Error del Orquestador</p>
              <p className="text-gray-400 text-sm leading-relaxed">{errors.orchestrator}</p>
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}
