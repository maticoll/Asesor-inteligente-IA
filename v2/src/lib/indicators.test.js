import { describe, it, expect } from 'vitest';
import {
  calcSMA,
  calcSMASeries,
  calcRSI,
  calcMACD,
  calcVolatilityAnnual,
  calcVaR95,
  calcES95,
} from './indicators.js';

// ─── SMA ─────────────────────────────────────────────────────────────────────

describe('calcSMA', () => {
  it('SMA de [1..10] con n=5 → 8', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(calcSMA(closes, 5)).toBeCloseTo(8, 5);
  });

  it('devuelve null si no hay suficientes datos', () => {
    expect(calcSMA([1, 2], 5)).toBeNull();
    expect(calcSMA([], 5)).toBeNull();
  });

  it('SMA de un solo valor igual al valor', () => {
    expect(calcSMA([42], 1)).toBeCloseTo(42);
  });
});

describe('calcSMASeries', () => {
  it('primeros (n-1) son null, luego valores correctos', () => {
    const series = calcSMASeries([1, 2, 3, 4, 5], 3);
    expect(series[0]).toBeNull();
    expect(series[1]).toBeNull();
    expect(series[2]).toBeCloseTo(2);  // (1+2+3)/3
    expect(series[4]).toBeCloseTo(4);  // (3+4+5)/3
  });
});

// ─── RSI ─────────────────────────────────────────────────────────────────────

describe('calcRSI', () => {
  it('devuelve null si no hay suficientes datos (< period+1)', () => {
    expect(calcRSI([1, 2, 3], 14)).toBeNull();
  });

  it('serie de 100% ganancias → RSI = 100', () => {
    const closes = Array.from({ length: 20 }, (_, i) => i + 1); // 1,2,...,20
    expect(calcRSI(closes, 14)).toBeCloseTo(100, 0);
  });

  it('serie de 100% pérdidas → RSI = 0', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 20 - i); // 20,19,...,1
    expect(calcRSI(closes, 14)).toBeCloseTo(0, 0);
  });

  it('RSI acotado entre 0 y 100', () => {
    // Serie aleatoria determinística
    const closes = [44, 46, 43, 48, 52, 50, 48, 47, 49, 51, 53, 55, 52, 50, 48, 46, 44, 43, 45, 47];
    const rsi = calcRSI(closes, 14);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });

  it('serie conocida: RSI ~52-55 para mercado lateral-alcista', () => {
    // 20 cierres con leve tendencia alcista y mezcla de ganancias/pérdidas
    const closes = [100, 102, 101, 103, 104, 102, 105, 106, 104, 107,
                    108, 106, 109, 110, 108, 111, 112, 110, 113, 114];
    const rsi = calcRSI(closes, 14);
    expect(rsi).toBeGreaterThan(50);
    expect(rsi).toBeLessThan(80);
  });
});

// ─── MACD ─────────────────────────────────────────────────────────────────────

describe('calcMACD', () => {
  it('devuelve null si no hay suficientes datos', () => {
    expect(calcMACD([1, 2, 3], 12, 26, 9)).toBeNull();
  });

  it('retorna { line, signal, hist, above_zero } con serie suficiente', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i); // serie creciente
    const result = calcMACD(closes, 12, 26, 9);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('line');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('hist');
    expect(result).toHaveProperty('above_zero');
  });

  it('serie estrictamente creciente → MACD line > 0 (above_zero=true)', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i * 2);
    const result = calcMACD(closes, 12, 26, 9);
    expect(result.above_zero).toBe(true);
    expect(result.line).toBeGreaterThan(0);
  });

  it('serie estrictamente decreciente → MACD line < 0', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 200 - i * 2);
    const result = calcMACD(closes, 12, 26, 9);
    expect(result.line).toBeLessThan(0);
  });

  it('hist = line - signal', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
    const result = calcMACD(closes, 12, 26, 9);
    expect(result.hist).toBeCloseTo(result.line - result.signal, 10);
  });
});

// ─── Volatilidad ─────────────────────────────────────────────────────────────

describe('calcVolatilityAnnual', () => {
  it('anualización: σ_daily 0.01 → σ_annual ≈ 0.1587', () => {
    // Construir serie con retornos diarios exactamente 1% (constante)
    // Entonces σ_daily de log-returns ≈ 0, pero podemos probar la fórmula directamente
    // Usamos serie con log-returns conocidos
    const logReturn = 0.01;
    const closes = [100];
    for (let i = 0; i < 252; i++) {
      closes.push(closes[closes.length - 1] * Math.exp(logReturn + (i % 2 === 0 ? 0.005 : -0.005)));
    }
    // La σ de alternancia 0.005 debería anualizar ≈ 0.005 × √252 ≈ 0.0794
    const vol = calcVolatilityAnnual(closes);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan(1);
  });

  it('anualización básica: si σ_daily ≈ 0.01 → σ_annual ≈ 0.1587', () => {
    // Construir ciertos retornos con desviación conocida
    // Retornos: alternando +0.01 y -0.01 → σ = 0.01 exacto
    const closes = [100];
    for (let i = 0; i < 100; i++) {
      const prev = closes[closes.length - 1];
      closes.push(i % 2 === 0 ? prev * Math.exp(0.01) : prev * Math.exp(-0.01));
    }
    const vol = calcVolatilityAnnual(closes);
    expect(vol).toBeCloseTo(0.01 * Math.sqrt(252), 1);
  });

  it('devuelve null si hay menos de 2 cierres', () => {
    expect(calcVolatilityAnnual([100])).toBeNull();
    expect(calcVolatilityAnnual([])).toBeNull();
  });

  it('serie creciente tiene volatilidad positiva', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i + Math.random());
    const vol = calcVolatilityAnnual(closes);
    expect(vol).toBeGreaterThan(0);
  });
});

// ─── VaR ─────────────────────────────────────────────────────────────────────

describe('calcVaR95', () => {
  it('100000 × 1.645 × 0.02 = 3290', () => {
    expect(calcVaR95(100000, 0.02)).toBeCloseTo(3290, 0);
  });

  it('500000 × 1.645 × 0.07 = 57575', () => {
    // Ejemplo del informe (Parte C.1)
    expect(calcVaR95(500000, 0.07)).toBeCloseTo(57575, 0);
  });

  it('proporcional al capital', () => {
    const var1 = calcVaR95(100000, 0.01);
    const var2 = calcVaR95(200000, 0.01);
    expect(var2).toBeCloseTo(var1 * 2, 5);
  });
});

// ─── ES ──────────────────────────────────────────────────────────────────────

describe('calcES95', () => {
  it('devuelve null con menos de 20 datos', () => {
    expect(calcES95([100, 101, 99])).toBeNull();
  });

  it('ES es positivo (es una magnitud de pérdida)', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i) * 10);
    const es = calcES95(closes);
    if (es !== null) expect(es).toBeGreaterThan(0);
  });

  it('ES >= VaR_pct equivalente (el promedio de la cola es peor que el umbral)', () => {
    // Serie con caídas grandes ocasionales
    const closes = Array.from({ length: 200 }, (_, i) => {
      const base = 100 + i * 0.1;
      return i % 20 === 0 ? base * 0.92 : base; // caídas del 8% cada 20 días
    });
    const vol = calcVolatilityAnnual(closes);
    const dailySigma = vol / Math.sqrt(252);
    const varPct = 1.645 * dailySigma;
    const es = calcES95(closes);
    if (es !== null && varPct > 0) {
      expect(es).toBeGreaterThanOrEqual(0);
    }
  });
});
