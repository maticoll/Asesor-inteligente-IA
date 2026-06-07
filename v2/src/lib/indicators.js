/**
 * indicators.js — Funciones puras de cálculo técnico y de riesgo
 *
 * Ref: INVESTIGACION_CRITERIOS_INVERSION.md
 *   - RSI(14):               Parte A.1 (Wilder, 1978)
 *   - MACD(12,26,9):         Parte A.2
 *   - SMA50/SMA200:          Parte A.3
 *   - Volatilidad anualizada: Parte C.2 (σ_daily × √252)
 *   - VaR 95% paramétrico:   Parte C.1 (z = 1.645)
 *   - ES 95% histórico:      Parte C.1 (promedio cola peor 5%)
 *
 * Todas las funciones son puras (sin efectos secundarios).
 */

// ─── Utilidades internas ──────────────────────────────────────────────────────

/**
 * EMA de una serie con factor de suavizado k = 2/(n+1).
 * El primer valor del EMA se inicializa con la SMA de los primeros n elementos.
 */
function calcEMA(values, n) {
  if (values.length < n) return [];
  const k = 2 / (n + 1);
  const result = [];
  // SMA inicial
  let ema = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  result.push(ema);
  for (let i = n; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ─── SMA ─────────────────────────────────────────────────────────────────────

/**
 * SMA simple: promedio de los últimos n cierres.
 * Devuelve null si no hay suficientes datos.
 * Ref: A.3
 */
export function calcSMA(closes, n) {
  if (!closes || closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

/**
 * Serie completa de SMAs de longitud n sobre `closes`.
 * Devuelve array de misma longitud que closes; primeros (n-1) son null.
 */
export function calcSMASeries(closes, n) {
  return closes.map((_, i) => {
    if (i < n - 1) return null;
    return closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
  });
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

/**
 * RSI de Wilder con suavizado exponencial (método original).
 * Devuelve el último valor RSI, o null si no hay datos suficientes.
 * Ref: A.1
 */
export function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Promedio inicial (SMA) para seed
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Suavizado de Wilder (Exponential Moving Average con α = 1/period)
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── MACD ─────────────────────────────────────────────────────────────────────

/**
 * MACD(fast, slow, sig).
 * Devuelve { line, signal, hist, above_zero } o null si no hay datos suficientes.
 * Ref: A.2
 */
export function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
  if (!closes || closes.length < slow + sig) return null;

  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  // Alinear: emaFast tiene más puntos que emaSlow
  const offset = emaFast.length - emaSlow.length;
  const macdLine = emaSlow.map((v, i) => emaFast[i + offset] - v);

  if (macdLine.length < sig) return null;
  const signalLine = calcEMA(macdLine, sig);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSig  = signalLine[signalLine.length - 1];

  // hist_prev: histograma de la barra anterior; null si no hay suficiente historia
  const prevMacd = macdLine.length >= 2 ? macdLine[macdLine.length - 2] : null;
  const prevSig  = signalLine.length >= 2 ? signalLine[signalLine.length - 2] : null;
  const hist_prev = (prevMacd != null && prevSig != null) ? prevMacd - prevSig : null;

  return {
    line:       lastMacd,
    signal:     lastSig,
    hist:       lastMacd - lastSig,
    hist_prev,
    above_zero: lastMacd > 0,
  };
}

// ─── Volatilidad ─────────────────────────────────────────────────────────────

/**
 * Volatilidad anualizada como σ de log-returns diarios × √252.
 * Ref: C.2
 */
export function calcVolatilityAnnual(closes) {
  if (!closes || closes.length < 2) return null;

  const logReturns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  if (logReturns.length < 2) return null;

  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// ─── VaR / ES ─────────────────────────────────────────────────────────────────

/**
 * VaR 95% paramétrico (1 día).
 * VaR = positionValue × z × σ_daily, con z = 1.645 para 95%.
 * Devuelve el valor en dólares (positivo = pérdida potencial).
 * Ref: C.1
 */
export function calcVaR95(positionValue, dailySigma) {
  const Z_95 = 1.645;
  return positionValue * Z_95 * dailySigma;
}

/**
 * Expected Shortfall (ES) / CVaR al 95%, método histórico.
 * Promedio de los retornos peores al percentil 5.
 * Devuelve fracción positiva (ej. 0.031 = 3.1% pérdida esperada en el peor 5%).
 * Ref: C.1
 */
export function calcES95(closes) {
  if (!closes || closes.length < 20) return null;

  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  if (returns.length < 10) return null;

  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff  = Math.floor(sorted.length * 0.05);
  if (cutoff === 0) return null;

  const tail = sorted.slice(0, cutoff);
  const avgTail = tail.reduce((a, b) => a + b, 0) / tail.length;
  return Math.abs(avgTail); // Devuelve positivo (magnitud de pérdida)
}
