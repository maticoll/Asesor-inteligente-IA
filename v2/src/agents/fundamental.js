/**
 * fundamental.js — Agente de Análisis Fundamental
 *
 * runFundamentalAgent(alphaData, onStatus) → FundamentalResult
 *
 * Lógica basada en INVESTIGACION_CRITERIOS_INVERSION.md:
 *   - Parte B.1 P/E: comparar contra mediana del sector (Damodaran), no cortes absolutos
 *   - Parte B.2 ROE: bueno >15%, penalizar si D/E alto (trampa del apalancamiento)
 *   - Parte B.3 PEG: <1 barato, ~1 justo, >1.5 caro, >2 muy caro
 *   - Parte B.4 FCF yield: >7-8% bueno; null → bajar confianza
 *   - Parte B.5 EPS growth: 10-15% sano, <5% débil, negativo malo
 *   - Parte E.3: fundamentales siempre relativos al sector
 *   - Parte E.5: cruzar ROE con deuda para no premiar calidad falsa
 */

import { sectorMedian } from '../lib/sectors.js';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── Scoring de cada métrica ────────────────────────────────────────────────────

function scorePE(pe, sectorPE) {
  // Ratio = pe / sector_median. Ref: B.1
  if (pe == null || pe <= 0 || sectorPE == null || sectorPE <= 0) {
    return { score: 0, verdict: 'unknown', delta: 0.0 };
  }
  const ratio = pe / sectorPE;
  if (ratio < 0.7)  return { score: +0.20, verdict: 'cheap' };
  if (ratio <= 1.3) return { score:  0.00, verdict: 'fair'  };
  return               { score: -0.20, verdict: 'expensive' };
}

function scoreROE(roe, debtToEquity) {
  // roe en fracción (ej. 0.147 = 14.7%). Ref: B.2
  if (roe == null) return { score: 0, verdict: 'unknown' };
  let sc;
  if (roe > 0.20)       sc = +0.15;
  else if (roe > 0.15)  sc = +0.10;
  else if (roe > 0.10)  sc = +0.00;
  else                  sc = -0.10;

  // Trampa del apalancamiento: ROE alto + D/E > 2 → reducir score ROE a la mitad
  if (debtToEquity != null && debtToEquity > 2 && sc > 0) {
    sc = sc / 2;
  }

  const pct = roe * 100;
  const verdict = roe > 0.15 ? 'strong' : roe > 0.10 ? 'acceptable' : 'weak';
  return { score: sc, verdict };
}

function scorePEG(peg, sectorPEG) {
  // Ref: B.3 — Lynch: PEG ~1 = bien valuado
  if (peg == null) return { score: 0, verdict: 'unknown' };
  if (peg < 1.0)   return { score: +0.20, verdict: 'cheap'     };
  if (peg < 1.5)   return { score:  0.00, verdict: 'fair'      };
  if (peg < 2.0)   return { score: -0.15, verdict: 'expensive' };
  return                   { score: -0.25, verdict: 'very_expensive' };
}

function scoreEPS(epsGrowth) {
  // epsGrowth en fracción (ej. 0.12 = 12%). Ref: B.5
  if (epsGrowth == null) return { score: 0, verdict: 'unknown' };
  if (epsGrowth > 0.15)  return { score: +0.15, verdict: 'strong'   };
  if (epsGrowth > 0.10)  return { score: +0.05, verdict: 'healthy'  };
  if (epsGrowth > 0.05)  return { score:  0.00, verdict: 'moderate' };
  if (epsGrowth > 0.00)  return { score: -0.05, verdict: 'weak'     };
  return                         { score: -0.15, verdict: 'negative' };
}

function scoreFCF(fcfYield) {
  // fcfYield en fracción. Ref: B.4
  if (fcfYield == null) return { score: 0, verdict: 'unknown', nullPenalty: true };
  if (fcfYield > 0.08)  return { score: +0.10, verdict: 'attractive', nullPenalty: false };
  if (fcfYield > 0.03)  return { score:  0.00, verdict: 'reasonable', nullPenalty: false };
  return                        { score: -0.10, verdict: 'poor',       nullPenalty: false };
}

// ── Agente principal ──────────────────────────────────────────────────────────

/**
 * @param {object} alphaData  - Salida del contrato de /api/alpha
 * @param {function} [onStatus]
 * @returns {FundamentalResult}
 */
export async function runFundamentalAgent(alphaData, onStatus = () => {}) {
  onStatus('Analizando fundamentales...');

  const {
    ticker = '',
    sector = null,
    pe_trailing = null,
    pe_forward  = null,
    roe         = null,
    peg         = null,
    eps_growth  = null,
    fcf_yield   = null,
    debt_to_equity = null,
    beta        = null,
  } = alphaData || {};

  const sectorPE  = sectorMedian(sector, 'pe');
  const sectorPEG = sectorMedian(sector, 'peg');

  // ── Scoring por métrica ─────────────────────────────────────────────────────
  const pe  = pe_trailing ?? pe_forward;  // preferir trailing; fallback a forward
  const peResult  = scorePE(pe,         sectorPE);
  const roeResult = scoreROE(roe,       debt_to_equity);
  const pegResult = scorePEG(peg,       sectorPEG);
  const epsResult = scoreEPS(eps_growth);
  const fcfResult = scoreFCF(fcf_yield);

  let score = peResult.score + roeResult.score + pegResult.score + epsResult.score + fcfResult.score;
  score = clamp(score, -1, 1);

  // ── Valuation ──────────────────────────────────────────────────────────────
  let valuation;
  if      (score >  0.10) valuation = 'cheap';
  else if (score < -0.10) valuation = 'expensive';
  else                     valuation = 'fair';

  // ── Quality score 0–100 (ROE + EPS + FCF) ──────────────────────────────────
  let qualityRaw = 50; // base
  qualityRaw += roeResult.score * 100; // max ±15
  qualityRaw += epsResult.score * 100; // max ±15
  if (!fcfResult.nullPenalty) qualityRaw += fcfResult.score * 100; // max ±10
  const quality_score = Math.round(clamp(qualityRaw, 0, 100));

  // ── Signal ────────────────────────────────────────────────────────────────
  let signal;
  if      (score >  0.10) signal = 'buy';
  else if (score < -0.10) signal = 'sell';
  else                     signal = 'hold';

  // ── Confianza ─────────────────────────────────────────────────────────────
  let confidence = 60;
  const absScore = Math.abs(score);
  confidence += Math.round(absScore * 30);        // max +30
  if (fcfResult.nullPenalty) confidence -= 8;    // FCF no disponible
  if (pe == null) {
    confidence = 40;   // earnings negativos/indefinidos → baja confianza
    signal = 'hold';   // Ref: B.1 — sin P/E válido, tender a hold
  }
  if (roe == null && peg == null) confidence -= 10; // pocos datos
  confidence = clamp(confidence, 10, 95);

  // ── Justificación ─────────────────────────────────────────────────────────
  const peStr  = pe   != null ? `P/E ${pe.toFixed(1)} (sector ${sectorPE})` : 'P/E no disponible';
  const roeStr = roe  != null ? `ROE ${(roe * 100).toFixed(1)}%` : 'ROE N/D';
  const pegStr = peg  != null ? `PEG ${peg.toFixed(2)}` : 'PEG N/D';
  const justification =
    `${peStr}, ${roeStr}, ${pegStr}. ` +
    `Valuación: ${valuation}. Quality: ${quality_score}/100. ` +
    `Señal ${signal.toUpperCase()} con confianza ${confidence}%.`;

  onStatus('Análisis fundamental completado.');

  return {
    signal,
    score: parseFloat(score.toFixed(3)),
    confidence,
    valuation,
    quality_score,
    metrics_vs_sector: {
      pe: {
        value:         pe,
        sector_median: sectorPE,
        verdict:       peResult.verdict,
      },
      roe: {
        value:   roe,
        verdict: roeResult.verdict,
      },
      peg: {
        value:   peg,
        verdict: pegResult.verdict,
      },
    },
    beta,
    justification,
  };
}
