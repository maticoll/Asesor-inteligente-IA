import { describe, it, expect } from 'vitest';
import { runTechnicalAgent } from './technical.js';

// ── Generadores de series sintéticas ──────────────────────────────────────────

/** Serie alcista: crece pct% diario durante n días */
function makeBull(n = 300, start = 100, pct = 0.005) {
  const closes = [start];
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * (1 + pct));
  return closes;
}

/** Serie bajista */
function makeBear(n = 300, start = 200, pct = 0.005) {
  const closes = [start];
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * (1 - pct));
  return closes;
}

/** Serie lateral: oscila ±amplitude alrededor de center */
function makeLateral(n = 300, center = 100, amplitude = 2) {
  return Array.from({ length: n }, (_, i) => center + (i % 2 === 0 ? amplitude : -amplitude));
}

/** Serie lateral con RSI bajo: oscila con sesgo de pérdida leve */
function makeLateralWithLowRSI(n = 300, center = 100) {
  // Sesgo de caídas para empujar RSI hacia zona de sobreventa
  return Array.from({ length: n }, (_, i) => center - (i % 3 === 0 ? 3 : 0) + (i % 5 === 0 ? 1 : 0));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runTechnicalAgent', () => {
  it('serie alcista sostenida → score > 0, regime uptrend', async () => {
    const closes = makeBull(300);
    const result = await runTechnicalAgent({ closes, ticker: 'BULL' });

    expect(result.regime).toBe('uptrend');
    expect(result.score).toBeGreaterThan(0);
    expect(['buy', 'hold']).toContain(result.signal);
    expect(result.confidence).toBeGreaterThan(40);
  });

  it('serie bajista sostenida → score < 0, regime downtrend, signal sell', async () => {
    const closes = makeBear(300);
    const result = await runTechnicalAgent({ closes, ticker: 'BEAR' });

    expect(result.regime).toBe('downtrend');
    expect(result.score).toBeLessThan(0);
    expect(result.signal).toBe('sell');
  });

  it('REGLA CRÍTICA E.1: NO buy por RSI<30 en downtrend confirmado', async () => {
    // Serie bajista con corrección profunda al final (RSI podría caer a zona sobreventa)
    const closes = makeBear(300, 200, 0.008); // bajista más pronunciada
    const result = await runTechnicalAgent({ closes, ticker: 'BEAR_DEEP' });

    // En downtrend, aunque RSI pueda ser bajo, NO debe ser buy
    if (result.regime === 'downtrend') {
      expect(result.signal).not.toBe('buy');
    }
  });

  it('serie lateral con RSI<30 → puede ser buy (en range)', async () => {
    // Serie con muchas bajas pequeñas para bajar el RSI, pero sin tendencia clara
    const n = 300;
    const closes = Array.from({ length: n }, (_, i) => {
      const base = 100;
      // Oscilación con sesgo bajista periódico para empujar RSI a zona 30
      return base - (i % 4 === 0 ? 3 : 0) + (i % 7 === 0 ? 1.5 : 0);
    });

    const result = await runTechnicalAgent({ closes, ticker: 'LATERAL_OVERSOLD' });
    // En range, si RSI < 30, el score debe ser mayor que en downtrend
    // Solo validamos que no colisiona la regla E.1
    expect(['buy', 'hold', 'sell']).toContain(result.signal);
    if (result.regime === 'range') {
      // El score puede ser positivo por RSI oversold en range
      expect(result.score).toBeGreaterThan(-1);
    }
  });

  it('pasa closes[] en el resultado (para el agente de riesgo)', async () => {
    const closes = makeBull(250);
    const result = await runTechnicalAgent({ closes, ticker: 'TEST' });
    expect(result.closes).toEqual(closes);
    expect(result.closes.length).toBe(250);
  });

  it('datos insuficientes → hold con baja confianza', async () => {
    const result = await runTechnicalAgent({ closes: [100, 101, 99], ticker: 'SHORT' });
    expect(result.signal).toBe('hold');
    expect(result.confidence).toBeLessThan(40);
  });

  it('contrato completo: todos los campos del contrato presentes', async () => {
    const closes = makeBull(250);
    const result = await runTechnicalAgent({ closes, ticker: 'AAPL' });

    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('regime');
    expect(result).toHaveProperty('indicators');
    expect(result).toHaveProperty('justification');
    expect(result).toHaveProperty('closes');
    expect(result.indicators).toHaveProperty('rsi');
    expect(result.indicators).toHaveProperty('macd');
    expect(result.indicators).toHaveProperty('sma50');
    expect(result.indicators).toHaveProperty('sma200');
    expect(result.indicators).toHaveProperty('golden_cross');
    expect(result.indicators).toHaveProperty('price_vs_sma200');
    expect(result.indicators).toHaveProperty('volatility_annual');
  });

  it('score acotado a [-1, +1]', async () => {
    const bull = await runTechnicalAgent({ closes: makeBull(300), ticker: 'B' });
    const bear = await runTechnicalAgent({ closes: makeBear(300), ticker: 'R' });
    expect(bull.score).toBeGreaterThanOrEqual(-1);
    expect(bull.score).toBeLessThanOrEqual(1);
    expect(bear.score).toBeGreaterThanOrEqual(-1);
    expect(bear.score).toBeLessThanOrEqual(1);
  });

  it('confidence acotada a [10, 95]', async () => {
    const result = await runTechnicalAgent({ closes: makeBull(300), ticker: 'C' });
    expect(result.confidence).toBeGreaterThanOrEqual(10);
    expect(result.confidence).toBeLessThanOrEqual(95);
  });
});
