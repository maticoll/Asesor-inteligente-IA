/**
 * regime.js — Clasificador de régimen de mercado
 *
 * Ref: INVESTIGACION_CRITERIOS_INVERSION.md — Parte A.1 (Constance Brown), E.1
 *
 * Reglas:
 *   uptrend:   precio > SMA200 AND SMA50 > SMA200 AND pendiente SMA50 ≥ 0
 *   downtrend: precio < SMA200 AND SMA50 < SMA200 AND pendiente SMA50 ≤ 0
 *   range:     cualquier otra configuración (ambigua)
 *
 * La pendiente de SMA50 se estima comparando el valor actual vs hace SLOPE_WINDOW períodos.
 * Un régimen ambiguo (parcialmente cumplido) siempre devuelve "range".
 */

const SLOPE_WINDOW = 5; // días para estimar la pendiente de SMA50

/**
 * classifyRegime({ closes, sma50, sma200 }) → "uptrend" | "downtrend" | "range"
 *
 * @param {object} params
 * @param {number[]} params.closes     - Serie de cierres (orden cronológico)
 * @param {number[]} params.sma50series - Serie completa de SMA50 (misma longitud que closes)
 * @param {number}  [params.sma50]    - Último valor SMA50 (calculado externamente si no se pasa serie)
 * @param {number}  [params.sma200]   - Último valor SMA200
 */
export function classifyRegime({ closes, sma50series, sma50, sma200 }) {
  if (!closes || closes.length < 2) return 'range';

  const price = closes[closes.length - 1];

  // Resolver SMA50 y SMA200
  const s50  = sma50  ?? (sma50series?.[sma50series.length - 1] ?? null);
  const s200 = sma200 ?? null;

  if (s50 == null || s200 == null) return 'range';

  // Pendiente SMA50: positiva si SMA50 actual > SMA50 hace SLOPE_WINDOW días
  let slope50 = 0;
  if (sma50series && sma50series.length > SLOPE_WINDOW) {
    const prev50 = sma50series[sma50series.length - 1 - SLOPE_WINDOW];
    if (prev50 != null) slope50 = s50 - prev50;
  }

  const priceAbove200  = price > s200;
  const sma50Above200  = s50   > s200;
  const slopePositive  = slope50 >= 0;

  const priceBelow200  = price < s200;
  const sma50Below200  = s50   < s200;
  const slopeNegative  = slope50 <= 0;

  if (priceAbove200 && sma50Above200 && slopePositive)  return 'uptrend';
  if (priceBelow200 && sma50Below200 && slopeNegative)  return 'downtrend';
  return 'range';
}
