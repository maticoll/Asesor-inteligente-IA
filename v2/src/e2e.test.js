/**
 * e2e.test.js — Tests de integración end-to-end (sin APIs reales)
 *
 * Simula los 4 escenarios principales del MVP usando datos sintéticos:
 *   1. AAPL — large-cap estable (uptrend, fundamentales sólidos)
 *   2. TSLA — alta volatilidad (risk high, peso reducido)
 *   3. JPM  — value/banco (P/E bajo vs sector Financial Services)
 *   4. XXXYZ — ticker inválido (agentes fallan con gracia)
 *
 * Prueba el pipeline completo: agentes determinísticos encadenados.
 * El orquestador (LLM) se omite aquí — está cubierto en orchestrator.test.js.
 */

import { describe, it, expect } from 'vitest';
import { runTechnicalAgent }   from './agents/technical.js';
import { runFundamentalAgent } from './agents/fundamental.js';
import { runRiskAgent }        from './agents/risk.js';

// ── Generadores de datos de mercado sintéticos ────────────────────────────────

/** Serie alcista: crece ~0.5% diario durante n días */
function makeBullSeries(n = 252, dailyRet = 0.005) {
  const closes = [150];
  for (let i = 1; i < n; i++) {
    closes.push(parseFloat((closes[i - 1] * (1 + dailyRet)).toFixed(4)));
  }
  return closes;
}

/** Serie de alta volatilidad: ±3% diario alternando */
function makeHighVolSeries(n = 252, sigma = 0.03) {
  const closes = [200];
  for (let i = 1; i < n; i++) {
    const ret = (i % 2 === 0 ? sigma : -sigma) * (1 + 0.1 * Math.sin(i));
    closes.push(parseFloat((closes[i - 1] * (1 + ret)).toFixed(4)));
  }
  return closes;
}

/** Serie lateral (range): oscila ±1% */
function makeRangeSeries(n = 252) {
  const closes = [100];
  for (let i = 1; i < n; i++) {
    const ret = (i % 2 === 0 ? 0.01 : -0.01);
    closes.push(parseFloat((closes[i - 1] * (1 + ret)).toFixed(4)));
  }
  return closes;
}

// ── Datos fundamentales sintéticos ───────────────────────────────────────────

const AAPL_FUND = {
  ticker: 'AAPL', sector: 'Technology',
  pe_trailing: 28, pe_forward: 26,
  roe: 1.5,           // Apple tiene ROE >100% por recompras
  peg: 2.1,
  eps_growth: 0.08,
  fcf_yield: null,
  debt_to_equity: null,
  beta: 1.2,
};

const TSLA_FUND = {
  ticker: 'TSLA', sector: 'Consumer Cyclical',
  pe_trailing: 60, pe_forward: 50,
  roe: 0.18,
  peg: 2.8,
  eps_growth: 0.15,
  fcf_yield: null,
  debt_to_equity: null,
  beta: 2.1,
};

const JPM_FUND = {
  ticker: 'JPM', sector: 'Financial Services',
  pe_trailing: 12,   // sector median 15 → ratio 0.8 → fair
  pe_forward: 11,
  roe: 0.16,          // >15% strong
  peg: 1.0,           // cheap
  eps_growth: 0.10,
  fcf_yield: null,
  debt_to_equity: null,
  beta: 1.0,
};

const PROFILE_MODERATE = { capital: 100000, risk_profile: 'moderate', horizon: 'medium' };
const PROFILE_CONSERVATIVE = { capital: 50000, risk_profile: 'conservative', horizon: 'long' };

// ── E2E Tests ─────────────────────────────────────────────────────────────────

describe('E2E — Pipeline completo (sin LLM)', () => {

  it('AAPL (uptrend, fundamentales Tech) → pipeline completa sin crash', async () => {
    const yahooData = { ticker: 'AAPL', closes: makeBullSeries(252), currentPrice: 210 };

    const tech = await runTechnicalAgent(yahooData);
    const fund = await runFundamentalAgent(AAPL_FUND);
    const risk = runRiskAgent(tech, fund, PROFILE_MODERATE);

    // Contratos completos
    expect(tech).toHaveProperty('signal');
    expect(tech).toHaveProperty('regime');
    expect(tech).toHaveProperty('closes');
    expect(fund).toHaveProperty('signal');
    expect(fund).toHaveProperty('valuation');
    expect(risk).toHaveProperty('risk_level');
    expect(risk).toHaveProperty('max_weight_pct');

    // Uptrend con 0.5% diario → régimen alcista
    expect(tech.regime).toBe('uptrend');

    // Risk clamp correcto
    expect(risk.max_weight_pct).toBeGreaterThan(0);
    expect(risk.max_weight_pct).toBeLessThanOrEqual(20);
  });

  it('TSLA (alta vol, beta>2) → risk_level high, peso < conservador', async () => {
    const yahooData = { ticker: 'TSLA', closes: makeHighVolSeries(252), currentPrice: 250 };

    const tech = await runTechnicalAgent(yahooData);
    const fund = await runFundamentalAgent(TSLA_FUND);

    const riskModerate     = runRiskAgent(tech, fund, PROFILE_MODERATE);
    const riskConservative = runRiskAgent(tech, fund, PROFILE_CONSERVATIVE);

    // Vol alta → risk high
    expect(riskModerate.risk_level).toBe('high');

    // Conservador siempre ≤ moderado para misma acción
    expect(riskConservative.max_weight_pct).toBeLessThanOrEqual(riskModerate.max_weight_pct);

    // Beta 2.1 → ajuste beta reduce peso significativamente
    expect(riskModerate.max_weight_pct).toBeLessThan(8);  // base moderado 8%

    // Score negativo por riesgo alto
    expect(riskModerate.score).toBeLessThan(0);
  });

  it('JPM (value, Financial Services, P/E 12 vs sector 15) → fundamental fair o cheap', async () => {
    const yahooData = { ticker: 'JPM', closes: makeBullSeries(252, 0.003), currentPrice: 200 };

    const tech = await runTechnicalAgent(yahooData);
    const fund = await runFundamentalAgent(JPM_FUND);
    const risk = runRiskAgent(tech, fund, PROFILE_MODERATE);

    // P/E 12 / sector 15 = 0.8 → fair (0.7-1.3)
    expect(fund.metrics_vs_sector.pe.verdict).toBe('fair');

    // ROE 16% strong
    expect(fund.metrics_vs_sector.roe.verdict).toBe('strong');

    // PEG 1.0 → fair (< 1.0 sería cheap, 1.0-1.5 es fair)
    expect(fund.metrics_vs_sector.peg.verdict).toBe('fair');

    // Beta 1.0 → sin penalización
    expect(risk.beta).toBeCloseTo(1.0, 1);
  });

  it('ticker inválido (datos ausentes) → agentes devuelven fallback, no crash', async () => {
    // Simula que Yahoo falló → yahooData vacío
    const yahooEmpty = { ticker: 'XXXYZ', closes: [], currentPrice: null };

    let tech;
    expect(() => {
      tech = runTechnicalAgent(yahooEmpty);
    }).not.toThrow();
    tech = await runTechnicalAgent(yahooEmpty);

    // Con 0 closes → fallback hold
    expect(tech.signal).toBe('hold');
    expect(tech.confidence).toBeLessThan(50);
    expect(tech.closes).toHaveLength(0);

    // Fundamental con datos vacíos → hold
    const fund = await runFundamentalAgent({});
    expect(fund.signal).toBe('hold');

    // Risk con resultado vacío → fallback coherente
    const risk = runRiskAgent({}, {}, PROFILE_MODERATE);
    expect(risk.risk_level).toBe('medium');
    expect(risk.max_weight_pct).toBeGreaterThan(0);
    expect(risk.var_95_pct).toBeNull();
  });

  it('pipeline completo encadenado: tech → fund → risk → contratos compatibles', async () => {
    const yahooData = { ticker: 'TEST', closes: makeRangeSeries(252), currentPrice: 100 };

    const tech = await runTechnicalAgent(yahooData);
    const fund = await runFundamentalAgent(JPM_FUND);
    const risk = runRiskAgent(tech, fund, PROFILE_MODERATE);

    // closes pasan correctamente de technical a risk
    expect(tech.closes).toBeDefined();
    expect(Array.isArray(tech.closes)).toBe(true);

    // beta pasa de fundamental a risk
    expect(risk.beta).toBeCloseTo(JPM_FUND.beta, 1);

    // Todos los campos del contrato están presentes
    ['risk_level', 'score', 'volatility_annual', 'var_95_pct',
     'var_95_usd', 'es_95_pct', 'beta', 'max_weight_pct', 'justification',
    ].forEach(field => expect(risk).toHaveProperty(field));
  });

  it('ambos agentes de datos fallan → risk y orch reciben fallbacks, no crash', () => {
    // Simula ambos agentes fallidos
    const techFail = { _error: 'Yahoo 404' };
    const fundFail = { _error: 'Alpha 429' };

    // Risk debe tolerar entradas vacías
    const risk = runRiskAgent(
      {},  // techFail sin closes
      {},  // fundFail sin beta
      PROFILE_MODERATE,
    );

    expect(risk.risk_level).toBe('medium');   // fallback
    expect(risk.var_95_pct).toBeNull();        // sin closes → null
    expect(risk.max_weight_pct).toBeGreaterThan(0);
    expect(risk.beta).toBeCloseTo(1.0, 1);     // fallback beta = 1.0
  });

});
