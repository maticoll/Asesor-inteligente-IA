import { describe, it, expect } from 'vitest';
import { runFundamentalAgent } from './fundamental.js';

// ── Datos de prueba ────────────────────────────────────────────────────────────

/** Empresa value: barata, rentable, crecimiento sano */
const VALUE_COMPANY = {
  ticker: 'VALUE', sector: 'Financial Services',
  pe_trailing: 8,          // sector median 15 → ratio 0.53 → cheap
  pe_forward: 7,
  roe: 0.22,               // >20% → strong
  peg: 0.8,                // <1 → cheap
  eps_growth: 0.18,        // >15% → strong
  fcf_yield: 0.09,         // >8% → attractive
  debt_to_equity: 0.5,
  beta: 0.9,
};

/** Empresa cara: P/E alto, PEG alto, crecimiento bajo */
const EXPENSIVE_COMPANY = {
  ticker: 'EXPENSIVE', sector: 'Technology',
  pe_trailing: 200,        // sector median 79 → ratio 2.53 → expensive
  pe_forward: 180,
  roe: 0.12,               // 10-15% → acceptable
  peg: 2.8,                // >2 → very expensive
  eps_growth: 0.03,        // <5% → weak
  fcf_yield: 0.01,         // <3% → poor
  debt_to_equity: 1.2,
  beta: 1.4,
};

/** ROE alto pero D/E muy alto → trampa del apalancamiento */
const LEVERED_COMPANY = {
  ticker: 'LEVER', sector: 'Industrials',
  pe_trailing: 18,         // sector 22 → fair
  pe_forward: 16,
  roe: 0.35,               // alto en apariencia
  peg: 1.2,                // fair
  eps_growth: 0.10,        // healthy
  fcf_yield: null,
  debt_to_equity: 3.5,     // D/E > 2 → penalizar ROE
  beta: 1.1,
};

/** Empresa con ganancias negativas → P/E indefinido */
const NEGATIVE_EARNINGS = {
  ticker: 'LOSS', sector: 'Healthcare',
  pe_trailing: null,       // earnings negativos
  pe_forward: null,
  roe: -0.05,              // negativo
  peg: null,
  eps_growth: -0.20,       // negativo
  fcf_yield: null,
  debt_to_equity: 2.0,
  beta: 1.6,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runFundamentalAgent', () => {
  it('empresa value (barata, rentable) → signal buy, valuation cheap', async () => {
    const result = await runFundamentalAgent(VALUE_COMPANY);
    expect(result.signal).toBe('buy');
    expect(result.valuation).toBe('cheap');
    expect(result.score).toBeGreaterThan(0.1);
    expect(result.quality_score).toBeGreaterThan(50);
  });

  it('empresa cara (P/E alto, PEG>2) → signal sell, valuation expensive', async () => {
    const result = await runFundamentalAgent(EXPENSIVE_COMPANY);
    expect(result.signal).toBe('sell');
    expect(result.valuation).toBe('expensive');
    expect(result.score).toBeLessThan(-0.1);
  });

  it('ROE alto + D/E > 2 → quality_score NO es máximo (penalización de apalancamiento)', async () => {
    const resultLevered   = await runFundamentalAgent(LEVERED_COMPANY);
    // Empresa idéntica pero sin deuda
    const resultUnlevered = await runFundamentalAgent({ ...LEVERED_COMPANY, debt_to_equity: 0.3 });

    // La apalancada debe tener menor quality_score que la no-apalancada
    expect(resultLevered.quality_score).toBeLessThan(resultUnlevered.quality_score);
    // También menor score general
    expect(resultLevered.score).toBeLessThan(resultUnlevered.score);
  });

  it('P/E null (earnings negativos) → confianza < 50, señal hold', async () => {
    const result = await runFundamentalAgent(NEGATIVE_EARNINGS);
    expect(result.confidence).toBeLessThan(50);
    expect(result.signal).toBe('hold');
  });

  it('contrato completo: todos los campos presentes', async () => {
    const result = await runFundamentalAgent(VALUE_COMPANY);
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('valuation');
    expect(result).toHaveProperty('quality_score');
    expect(result).toHaveProperty('metrics_vs_sector');
    expect(result.metrics_vs_sector).toHaveProperty('pe');
    expect(result.metrics_vs_sector).toHaveProperty('roe');
    expect(result.metrics_vs_sector).toHaveProperty('peg');
    expect(result).toHaveProperty('beta');
    expect(result).toHaveProperty('justification');
  });

  it('score acotado a [-1, +1]', async () => {
    const r1 = await runFundamentalAgent(VALUE_COMPANY);
    const r2 = await runFundamentalAgent(EXPENSIVE_COMPANY);
    expect(r1.score).toBeGreaterThanOrEqual(-1);
    expect(r1.score).toBeLessThanOrEqual(1);
    expect(r2.score).toBeGreaterThanOrEqual(-1);
    expect(r2.score).toBeLessThanOrEqual(1);
  });

  it('P/E relativo al sector: mismo P/E, diferente sector → diferente veredicto', async () => {
    // P/E = 30: cheap en Technology (median 79), caro en Energy (median 12)
    const techResult   = await runFundamentalAgent({ ...VALUE_COMPANY, pe_trailing: 30, sector: 'Technology' });
    const energyResult = await runFundamentalAgent({ ...VALUE_COMPANY, pe_trailing: 30, sector: 'Energy' });
    expect(techResult.metrics_vs_sector.pe.verdict).toBe('cheap');     // 30/79 = 0.38 < 0.7
    expect(energyResult.metrics_vs_sector.pe.verdict).toBe('expensive'); // 30/12 = 2.5 > 1.3
  });

  it('datos vacíos → no lanza error', async () => {
    const result = await runFundamentalAgent({});
    expect(result.signal).toBe('hold');
    expect(result.confidence).toBeLessThan(60);
  });
});
