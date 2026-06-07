/**
 * technical.js — Agente de Análisis Técnico
 *
 * runTechnicalAgent(yahooData, onStatus) → TechnicalResult
 *
 * Lógica basada en INVESTIGACION_CRITERIOS_INVERSION.md:
 *   - Parte A.1 RSI(14): filtro de tendencia (RSI-50) + disparadores por régimen
 *   - Parte A.2 MACD(12,26,9): filtro (línea cero) + cruce de señal
 *   - Parte A.3 SMA50/200: Golden/Death Cross + precio vs SMA200
 *   - Parte E.1: detectar régimen PRIMERO; aplicar rangos de Constance Brown
 *
 * Regla crítica (E.1): NO recomendar buy por RSI<30 en downtrend confirmado.
 * La tendencia domina sobre las señales de reversión.
 */

import { calcRSI, calcMACD, calcSMA, calcSMASeries, calcVolatilityAnnual } from '../lib/indicators.js';
import { classifyRegime } from '../lib/regime.js';

// ── Constantes de scoring ─────────────────────────────────────────────────────
// Cada factor suma al score acumulado; el total se acota a [-1, +1]
const W = {
  // Filtros de tendencia (dirección general)
  RSI_ABOVE_50:    +0.10,
  RSI_BELOW_50:    -0.10,
  MACD_ABOVE_ZERO: +0.10,
  MACD_BELOW_ZERO: -0.10,

  // Disparadores en range
  RSI_OVERSOLD_RANGE:     +0.30,  // RSI < 30 en rango
  RSI_OVERBOUGHT_RANGE:   -0.30,  // RSI > 70 en rango
  MACD_CROSS_UP_RANGE:    +0.20,  // cruce alcista en rango
  MACD_CROSS_DOWN_RANGE:  -0.20,  // cruce bajista en rango

  // Disparadores en uptrend
  RSI_DIP_UPTREND:    +0.20,  // RSI 40-50 en uptrend (comprar corrección)
  GOLDEN_CROSS:       +0.15,
  PRICE_ABOVE_SMA200: +0.10,

  // Disparadores en downtrend
  RSI_BOUNCE_DOWNTREND: -0.20,  // RSI 50-60 en downtrend (resistencia)
  DEATH_CROSS:          -0.15,
  PRICE_BELOW_SMA200:   -0.10,
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/**
 * @param {object} yahooData   - Salida del contrato de /api/yahoo
 * @param {function} [onStatus] - Callback de estado: onStatus(msg)
 * @returns {TechnicalResult}
 */
export async function runTechnicalAgent(yahooData, onStatus = () => {}) {
  onStatus('Calculando indicadores técnicos...');

  const { closes = [], ticker = '' } = yahooData || {};

  if (!closes || closes.length < 30) {
    return {
      signal: 'hold', score: 0, confidence: 20, regime: 'range',
      indicators: {}, justification: 'Datos insuficientes para análisis técnico.',
      closes,
    };
  }

  // ── Calcular indicadores ───────────────────────────────────────────────────
  const rsi  = calcRSI(closes, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const sma50series  = calcSMASeries(closes, 50);
  const sma200series = calcSMASeries(closes, 200);
  const sma50  = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);
  const volAnnual = calcVolatilityAnnual(closes);

  onStatus('Clasificando régimen de mercado...');

  // ── Clasificar régimen ─────────────────────────────────────────────────────
  const regime = classifyRegime({ closes, sma50series, sma50, sma200 });

  // Golden Cross / Death Cross (SMA50 vs SMA200)
  const goldenCross = sma50 != null && sma200 != null && sma50 > sma200;
  const priceVsSMA200 = sma200 != null
    ? (closes[closes.length - 1] > sma200 ? 'above' : 'below')
    : 'unknown';

  // Cruce real de MACD: cambio de signo del histograma entre las dos últimas barras.
  // macdCrossUp  = histograma pasó de negativo (o cero) a positivo → señal de compra.
  // macdCrossDown = histograma pasó de positivo (o cero) a negativo → señal de venta.
  // Si hist_prev es null (no hay barra anterior), no se detecta cruce.
  const macdCrossUp   = macd?.hist_prev != null && macd.hist_prev < 0 && macd.hist > 0;
  const macdCrossDown = macd?.hist_prev != null && macd.hist_prev > 0 && macd.hist < 0;

  onStatus('Aplicando reglas por régimen...');

  // ── Scoring por régimen (Constante Brown + reglas del informe) ────────────
  let score = 0;
  const factors = [];

  // 1. Filtros de tendencia (siempre aplican)
  if (rsi != null) {
    if (rsi > 50) { score += W.RSI_ABOVE_50; factors.push('RSI>50 sesgo alcista'); }
    else           { score += W.RSI_BELOW_50; factors.push('RSI<50 sesgo bajista'); }
  }
  if (macd) {
    if (macd.above_zero) { score += W.MACD_ABOVE_ZERO; factors.push('MACD>0 tendencia alcista'); }
    else                  { score += W.MACD_BELOW_ZERO; factors.push('MACD<0 tendencia bajista'); }
  }

  // 2. Disparadores según régimen
  if (regime === 'range') {
    if (rsi != null && rsi < 30) { score += W.RSI_OVERSOLD_RANGE;   factors.push('RSI<30 sobreventa en rango'); }
    if (rsi != null && rsi > 70) { score += W.RSI_OVERBOUGHT_RANGE; factors.push('RSI>70 sobrecompra en rango'); }
    if (macdCrossUp)   { score += W.MACD_CROSS_UP_RANGE;   factors.push('Cruce MACD alcista en rango'); }
    if (macdCrossDown) { score += W.MACD_CROSS_DOWN_RANGE; factors.push('Cruce MACD bajista en rango'); }

  } else if (regime === 'uptrend') {
    // En uptrend: comprar la corrección (RSI 40-50), no shortear RSI>70
    if (rsi != null && rsi >= 40 && rsi <= 50) { score += W.RSI_DIP_UPTREND; factors.push('RSI en zona de compra (corrección en uptrend)'); }
    if (goldenCross) { score += W.GOLDEN_CROSS; factors.push('Golden Cross SMA50>SMA200'); }
    if (priceVsSMA200 === 'above') { score += W.PRICE_ABOVE_SMA200; factors.push('Precio sobre SMA200'); }
    // Ignorar RSI<30 en uptrend: puede ser señal de aceleración bajista TEMPORAL
    // Si RSI<30 en uptrend, es corrección profunda → agregar solo si hay confirmación
    // (no agregar el W.RSI_OVERSOLD_RANGE aquí)

  } else if (regime === 'downtrend') {
    // REGLA CRÍTICA E.1: NO dar buy por RSI<30 en downtrend
    if (rsi != null && rsi >= 50 && rsi <= 60) { score += W.RSI_BOUNCE_DOWNTREND; factors.push('RSI 50-60 rebote en downtrend (resistencia)'); }
    if (!goldenCross && sma50 != null && sma200 != null && sma50 < sma200) {
      score += W.DEATH_CROSS; factors.push('Death Cross SMA50<SMA200');
    }
    if (priceVsSMA200 === 'below') { score += W.PRICE_BELOW_SMA200; factors.push('Precio bajo SMA200'); }
  }

  // ── Acotar score ──────────────────────────────────────────────────────────
  score = clamp(score, -1, 1);

  // ── Derivar señal ─────────────────────────────────────────────────────────
  let signal;
  if      (score >  0.15) signal = 'buy';
  else if (score < -0.15) signal = 'sell';
  else                     signal = 'hold';

  // ── Calcular confianza ────────────────────────────────────────────────────
  // Base 50; sube si filtros y disparadores coinciden; baja en régimen ambiguo
  let confidence = 50;
  const absScore = Math.abs(score);
  confidence += Math.round(absScore * 35);            // max +35 por señal fuerte
  if (regime === 'range') confidence -= 10;           // −10 en rango (más ruido)
  if (factors.length >= 3) confidence += 5;           // +5 si hay confirmación múltiple
  if (rsi == null || macd == null) confidence -= 15;  // −15 si faltan indicadores clave
  confidence = clamp(confidence, 10, 95);

  // ── Justificación en español ──────────────────────────────────────────────
  const regimeLabel = { uptrend: 'alcista', downtrend: 'bajista', range: 'lateral' }[regime];
  const rsiStr = rsi != null ? `RSI ${rsi.toFixed(1)}` : 'RSI N/D';
  const macdStr = macd ? `MACD ${macd.above_zero ? 'positivo' : 'negativo'}` : 'MACD N/D';
  const justification =
    `Régimen ${regimeLabel}. ${rsiStr}. ${macdStr}. ` +
    (goldenCross ? 'Golden Cross activo. ' : sma50 != null && sma200 != null && sma50 < sma200 ? 'Death Cross activo. ' : '') +
    `Señal ${signal.toUpperCase()} con confianza ${confidence}%. Factores: ${factors.join('; ')}.`;

  onStatus('Análisis técnico completado.');

  return {
    signal,
    score: parseFloat(score.toFixed(3)),
    confidence,
    regime,
    indicators: {
      rsi:              rsi != null ? parseFloat(rsi.toFixed(2)) : null,
      macd:             macd ? {
        line:       parseFloat(macd.line.toFixed(4)),
        signal:     parseFloat(macd.signal.toFixed(4)),
        hist:       parseFloat(macd.hist.toFixed(4)),
        above_zero: macd.above_zero,
      } : null,
      sma50:            sma50 != null ? parseFloat(sma50.toFixed(2)) : null,
      sma200:           sma200 != null ? parseFloat(sma200.toFixed(2)) : null,
      golden_cross:     goldenCross,
      price_vs_sma200:  priceVsSMA200,
      volatility_annual: volAnnual != null ? parseFloat(volAnnual.toFixed(4)) : null,
    },
    justification,
    closes,
  };
}
