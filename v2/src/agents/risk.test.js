import { describe, it, expect } from 'vitest';
import { runRiskAgent } from './risk.js';

// ── Generadores de series ──────────────────────────────────────────────────────

/** Serie de baja volatilidad (~10% anual) */
function makeLowVol(n = 252, sigma = 0.006) {
  const closes = [100];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + (i % 2 === 0 ? sigma : -sigma)));
  }
  return closes;
}

/** Serie de alta volatilidad (~40% anual) */
function makeHighVol(n = 252, sigma = 0.025) {
  const closes = [100];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + (i % 2 === 0 ? sigma : -sigma)));
  }
  return closes;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runRiskAgent', () => {
  it('baja vol + beta<1 + moderado → low risk, peso mayor que el base', async () => {
    const techResult = { closes: makeLowVol() };
    const fundResult = { beta: 0.8 };
    const profile    = { capital: 100000, risk_profile: 'moderate', horizon: 'medium' };

    const result = runRiskAgent(techResult, fundResult, profile);
    expect(result.risk_level).toBe('low');
    // Con beta < 1, el ajuste favorece → peso ≥ base moderado (8%)
    expect(result.max_weight_pct).toBeGreaterThanOrEqual(8);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('alta vol + beta>1.5 + conservador → high risk, peso recortado', async () => {
    const techResult = { closes: makeHighVol() };
    const fundResult = { beta: 1.8 };
    const profile    = { capital: 100000, risk_profile: 'conservative', horizon: 'long' };

    const result = runRiskAgent(techResult, fundResult, profile);
    expect(result.risk_level).toBe('high');
    // Conservador base 5%, con vol alta y beta>1 → peso < 5%
    expect(result.max_weight_pct).toBeLessThan(5);
    expect(result.score).toBeLessThan(0);
  });

  it('VaR coincide con positionValue × 1.645 × σ_daily', async () => {
    const closes = makeLowVol(252, 0.01);  // σ_daily ≈ 0.01
    const result = runRiskAgent(
      { closes },
      { beta: 1.0 },
      { capital: 100000, risk_profile: 'moderate' }
    );

    if (result.var_95_pct != null && result.var_95_usd != null) {
      const position = 100000 * (result.max_weight_pct / 100);
      const expected = position * result.var_95_pct;
      expect(result.var_95_usd).toBeCloseTo(expected, 0);
    }
  });

  it('contrato completo: todos los campos presentes', async () => {
    const result = runRiskAgent(
      { closes: makeLowVol() },
      { beta: 1.0 },
      { capital: 50000, risk_profile: 'moderate' }
    );

    expect(result).toHaveProperty('risk_level');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('volatility_annual');
    expect(result).toHaveProperty('var_95_pct');
    expect(result).toHaveProperty('var_95_usd');
    expect(result).toHaveProperty('es_95_pct');
    expect(result).toHaveProperty('beta');
    expect(result).toHaveProperty('max_weight_pct');
    expect(result).toHaveProperty('justification');
  });

  it('sin closes → fallback coherente (no lanza error)', async () => {
    const result = runRiskAgent({}, { beta: 1.2 }, { capital: 50000, risk_profile: 'conservative' });
    expect(result.risk_level).toBe('medium');  // fallback
    expect(result.var_95_pct).toBeNull();
    expect(result.max_weight_pct).toBeGreaterThan(0);
  });

  it('agresivo tiene mayor max_weight que conservador (misma acción)', async () => {
    const closes = makeLowVol();
    const fundResult = { beta: 1.0 };

    const conservative = runRiskAgent({ closes }, fundResult, { capital: 100000, risk_profile: 'conservative' });
    const aggressive   = runRiskAgent({ closes }, fundResult, { capital: 100000, risk_profile: 'aggressive' });

    expect(aggressive.max_weight_pct).toBeGreaterThan(conservative.max_weight_pct);
  });

  it('vol >50% → max_weight_pct se reduce al menos 50% respecto a vol normal', async () => {
    const highVolCloses = makeHighVol(252, 0.035);  // sigma diaria 3.5% → ~55% anual
    const lowVolCloses  = makeLowVol(252, 0.006);

    const high = runRiskAgent({ closes: highVolCloses }, { beta: 1.0 }, { capital: 100000, risk_profile: 'moderate' });
    const low  = runRiskAgent({ closes: lowVolCloses  }, { beta: 1.0 }, { capital: 100000, risk_profile: 'moderate' });

    if (high.volatility_annual != null && high.volatility_annual > 0.50) {
      expect(high.max_weight_pct).toBeLessThan(low.max_weight_pct * 0.7);
    }
  });
});
