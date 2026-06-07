import { describe, it, expect } from 'vitest';
import { classifyRegime } from './regime.js';
import { calcSMASeries } from './indicators.js';

// Generadores de series sintéticas
function makeTrending(n, startPrice, dailyReturn) {
  const closes = [startPrice];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + dailyReturn));
  }
  return closes;
}

function makeLateral(n, center, amplitude) {
  return Array.from({ length: n }, (_, i) => center + (i % 2 === 0 ? amplitude : -amplitude));
}

describe('classifyRegime', () => {
  it('serie alcista sostenida → uptrend', () => {
    const closes = makeTrending(300, 50, 0.005); // +0.5% diario
    const sma50series  = calcSMASeries(closes, 50);
    const sma200series = calcSMASeries(closes, 200);
    const sma50  = sma50series[sma50series.length - 1];
    const sma200 = sma200series[sma200series.length - 1];

    const regime = classifyRegime({ closes, sma50series, sma50, sma200 });
    expect(regime).toBe('uptrend');
  });

  it('serie bajista sostenida → downtrend', () => {
    const closes = makeTrending(300, 200, -0.005); // −0.5% diario
    const sma50series  = calcSMASeries(closes, 50);
    const sma200series = calcSMASeries(closes, 200);
    const sma50  = sma50series[sma50series.length - 1];
    const sma200 = sma200series[sma200series.length - 1];

    const regime = classifyRegime({ closes, sma50series, sma50, sma200 });
    expect(regime).toBe('downtrend');
  });

  it('serie lateral alrededor de un centro → range', () => {
    const closes = makeLateral(300, 100, 1);
    const sma50series  = calcSMASeries(closes, 50);
    const sma200series = calcSMASeries(closes, 200);
    const sma50  = sma50series[sma50series.length - 1];
    const sma200 = sma200series[sma200series.length - 1];

    const regime = classifyRegime({ closes, sma50series, sma50, sma200 });
    expect(regime).toBe('range');
  });

  it('precio por encima de SMA200 pero SMA50 < SMA200 → range (mixto)', () => {
    // Precio artificialmente alto, SMA50 bajo, SMA200 en el medio
    const regime = classifyRegime({
      closes: [150],
      sma50series: [null, null, 90], // SMA50 < SMA200
      sma50: 90,
      sma200: 100,
    });
    expect(regime).toBe('range');
  });

  it('devuelve range si faltan SMA', () => {
    expect(classifyRegime({ closes: [100], sma50: null, sma200: null })).toBe('range');
    expect(classifyRegime({ closes: [] })).toBe('range');
  });
});
