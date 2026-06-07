/**
 * risk.js — Agente de Gestión de Riesgo (determinístico, sin API)
 *
 * runRiskAgent(techResult, fundResult, profile, onStatus) → RiskResult
 *
 * Lógica basada en INVESTIGACION_CRITERIOS_INVERSION.md:
 *   - Parte C.1: VaR 95% paramétrico (z=1.645) + ES 95% histórico
 *   - Parte C.2: Volatilidad anualizada, bandas 15/30
 *   - Parte C.3: Ponderación por perfil, escalado por beta y volatilidad
 *                Conservador base 5%, Moderado 8%, Agresivo 12%
 */

import { calcVolatilityAnnual, calcVaR95, calcES95 } from '../lib/indicators.js';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Pesos base por perfil de riesgo (% máximo de cartera)
const BASE_WEIGHT = {
  conservative: 5,
  moderate:     8,
  aggressive:   12,
};

/**
 * @param {object} techResult   - Salida de runTechnicalAgent (necesita .closes[])
 * @param {object} fundResult   - Salida de runFundamentalAgent (necesita .beta)
 * @param {object} profile      - { capital, risk_profile, horizon }
 * @param {function} [onStatus]
 * @returns {RiskResult}
 */
export function runRiskAgent(techResult, fundResult, profile = {}, onStatus = () => {}) {
  onStatus('Calculando métricas de riesgo...');

  const closes = techResult?.closes || [];
  const beta   = fundResult?.beta   ?? 1.0;  // fallback a beta de mercado
  const capital = profile?.capital   ?? 50000;
  const riskProfile = profile?.risk_profile ?? 'moderate';

  // ── Volatilidad anualizada ─────────────────────────────────────────────────
  const volAnnual  = closes.length >= 2 ? calcVolatilityAnnual(closes) : null;
  const dailySigma = volAnnual != null ? volAnnual / Math.sqrt(252) : null;

  // ── Risk level (bandas C.2: 15% low / 30% high) ───────────────────────────
  let risk_level;
  if      (volAnnual == null)   risk_level = 'medium';  // fallback si no hay datos
  else if (volAnnual < 0.15)    risk_level = 'low';
  else if (volAnnual < 0.30)    risk_level = 'medium';
  else                          risk_level = 'high';

  // ── Ponderación máxima (Parte C.3) ────────────────────────────────────────
  const baseWeight = BASE_WEIGHT[riskProfile] ?? BASE_WEIGHT.moderate;

  // Ajuste por beta: posición de 5% en beta=2 aporta 10% de riesgo equivalente
  // → reducir: weight × min(1, 1/beta)
  const betaAdj = beta > 0 ? Math.min(1, 1 / beta) : 1;

  // Ajuste por volatilidad alta
  let volAdj = 1.0;
  if (volAnnual != null) {
    if      (volAnnual > 0.50) volAdj = 0.50;  // >50% vol → reducir 50%
    else if (volAnnual > 0.30) volAdj = 0.70;  // >30% vol → reducir 30%
  }

  let max_weight_pct = baseWeight * betaAdj * volAdj;
  max_weight_pct = parseFloat(clamp(max_weight_pct, 0.5, 20).toFixed(2));

  // ── VaR 95% ───────────────────────────────────────────────────────────────
  // Posición tentativa = capital × (max_weight_pct / 100)
  const positionValue = capital * (max_weight_pct / 100);
  const var_95_usd = dailySigma != null
    ? parseFloat(calcVaR95(positionValue, dailySigma).toFixed(2))
    : null;
  const var_95_pct = dailySigma != null
    ? parseFloat((1.645 * dailySigma).toFixed(4))
    : null;

  // ── ES 95% histórico ──────────────────────────────────────────────────────
  const es_95_raw = closes.length >= 20 ? calcES95(closes) : null;
  const es_95_pct = es_95_raw != null ? parseFloat(es_95_raw.toFixed(4)) : null;

  // ── Score de riesgo ────────────────────────────────────────────────────────
  // Negativo porque el riesgo penaliza; el orquestador pondera con esto
  let score;
  if      (risk_level === 'low')    score = +0.10;
  else if (risk_level === 'medium') score =  0.00;
  else                               score = -0.30;

  // Penalización extra por beta muy alta
  if (beta > 2.0) score -= 0.10;
  score = clamp(score, -1, 1);

  // ── Justificación ─────────────────────────────────────────────────────────
  const volStr = volAnnual != null ? `Vol. anual ${(volAnnual * 100).toFixed(1)}%` : 'Vol. N/D';
  const betaStr = `Beta ${beta.toFixed(2)}`;
  const justification =
    `${volStr}. ${betaStr}. Nivel de riesgo: ${risk_level}. ` +
    `Peso máximo ${riskProfile}: ${max_weight_pct}% ` +
    `(base ${baseWeight}% × beta_adj ${betaAdj.toFixed(2)} × vol_adj ${volAdj.toFixed(2)}). ` +
    (var_95_pct ? `VaR 95% diario: ${(var_95_pct * 100).toFixed(2)}%.` : '');

  onStatus('Análisis de riesgo completado.');

  return {
    risk_level,
    score: parseFloat(score.toFixed(3)),
    volatility_annual: volAnnual != null ? parseFloat(volAnnual.toFixed(4)) : null,
    var_95_pct,
    var_95_usd,
    es_95_pct,
    beta: parseFloat(beta.toFixed(4)),
    max_weight_pct,
    justification,
  };
}
