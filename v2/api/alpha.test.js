import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calcFCF, calcDebtToEquity } from './alpha.js';

// ── Tests de funciones puras ────────────────────────────────────────────────────

describe('calcFCF', () => {
  it('operatingCashflow - capitalExpenditures', () => {
    expect(calcFCF({ operatingCashflow: '10000000', capitalExpenditures: '3000000' }))
      .toBeCloseTo(7000000);
  });

  it('devuelve null si falta operatingCashflow', () => {
    expect(calcFCF({ capitalExpenditures: '3000000' })).toBeNull();
  });

  it('devuelve null si falta capitalExpenditures', () => {
    expect(calcFCF({ operatingCashflow: '10000000' })).toBeNull();
  });

  it('devuelve null si report es null o no-objeto', () => {
    expect(calcFCF(null)).toBeNull();
    expect(calcFCF(undefined)).toBeNull();
    expect(calcFCF('string')).toBeNull();
  });

  it('maneja valores "None" como null', () => {
    expect(calcFCF({ operatingCashflow: 'None', capitalExpenditures: '3000000' })).toBeNull();
  });

  it('FCF puede ser negativo (gasto de capital mayor al flujo operativo)', () => {
    const result = calcFCF({ operatingCashflow: '1000000', capitalExpenditures: '5000000' });
    expect(result).toBeCloseTo(-4000000);
  });
});

describe('calcDebtToEquity', () => {
  it('totalLiabilities / totalShareholderEquity', () => {
    expect(calcDebtToEquity({ totalLiabilities: '200000', totalShareholderEquity: '100000' }))
      .toBeCloseTo(2.0);
  });

  it('devuelve null si equity es 0', () => {
    expect(calcDebtToEquity({ totalLiabilities: '200000', totalShareholderEquity: '0' }))
      .toBeNull();
  });

  it('devuelve null si equity es negativo', () => {
    expect(calcDebtToEquity({ totalLiabilities: '200000', totalShareholderEquity: '-50000' }))
      .toBeNull();
  });

  it('devuelve null si report es null', () => {
    expect(calcDebtToEquity(null)).toBeNull();
  });

  it('devuelve null si faltan campos', () => {
    expect(calcDebtToEquity({ totalLiabilities: '200000' })).toBeNull();
  });

  it('maneja valores "None" como null', () => {
    expect(calcDebtToEquity({ totalLiabilities: 'None', totalShareholderEquity: '100000' }))
      .toBeNull();
  });
});

// ── Tests del handler ──────────────────────────────────────────────────────────

// Datos mock de Alpha Vantage
const MOCK_OVERVIEW = {
  Symbol: 'AAPL', Sector: 'Technology',
  TrailingPE: '28.5', ForwardPE: '25.0',
  ReturnOnEquityTTM: '1.415', PEGRatio: '2.8',
  QuarterlyEarningsGrowthYOY: '0.05',
  Beta: '1.2', MarketCapitalization: '2800000000000',
};

const MOCK_BALANCE = {
  annualReports: [{
    totalLiabilities: '290000000000',
    totalShareholderEquity: '56000000000',
  }],
};

const MOCK_CASHFLOW = {
  annualReports: [{
    operatingCashflow: '110000000000',
    capitalExpenditures: '11000000000',
  }],
};

function makeReq(ticker) {
  return { method: 'GET', query: { ticker } };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
    end() { return this; },
  };
  return res;
}

describe('alpha handler', () => {
  let fetchMock;

  beforeEach(() => {
    // Stub process.env
    vi.stubEnv('ALPHA_VANTAGE_API_KEY', 'TEST_KEY');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules(); // limpia el cache en memoria entre tests
  });

  it('respuesta completa: debt_to_equity, fcf, fcf_yield calculados correctamente', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => MOCK_OVERVIEW })
      .mockResolvedValueOnce({ json: async () => MOCK_BALANCE })
      .mockResolvedValueOnce({ json: async () => MOCK_CASHFLOW });

    // Re-importar handler fresco (sin cache previo)
    const { default: handler } = await import('./alpha.js?ts=' + Date.now());
    const req = makeReq('AAPL');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const body = res._body;
    expect(body.ticker).toBe('AAPL');
    expect(body.debt_to_equity).toBeCloseTo(290000000000 / 56000000000, 3);
    expect(body.fcf).toBeCloseTo(110000000000 - 11000000000);
    expect(body.fcf_yield).toBeCloseTo((110000000000 - 11000000000) / 2800000000000, 6);
  });

  it('rate limit en BALANCE_SHEET → 200 con debt_to_equity null (no rompe el flujo)', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => MOCK_OVERVIEW })
      .mockResolvedValueOnce({ json: async () => ({ Note: 'API rate limit reached' }) })
      .mockResolvedValueOnce({ json: async () => MOCK_CASHFLOW });

    const { default: handler } = await import('./alpha.js?ts=' + Date.now());
    const req = makeReq('MSFT');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.debt_to_equity).toBeNull();
    expect(res._body.fcf).not.toBeNull(); // cash flow sí llegó
  });

  it('rate limit en OVERVIEW → 429 (error correcto)', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({ Note: 'API rate limit reached' }) })
      .mockResolvedValueOnce({ json: async () => MOCK_BALANCE })
      .mockResolvedValueOnce({ json: async () => MOCK_CASHFLOW });

    const { default: handler } = await import('./alpha.js?ts=' + Date.now());
    const req = makeReq('TSLA');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(429);
  });

  it('ticker no encontrado (OVERVIEW vacío) → 404', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({}) }) // sin Symbol
      .mockResolvedValueOnce({ json: async () => MOCK_BALANCE })
      .mockResolvedValueOnce({ json: async () => MOCK_CASHFLOW });

    const { default: handler } = await import('./alpha.js?ts=' + Date.now());
    const req = makeReq('INVALID');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(404);
  });

  it('falta API key → 500', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('ALPHA_VANTAGE_API_KEY', '');

    const { default: handler } = await import('./alpha.js?ts=' + Date.now());
    const req = makeReq('AAPL');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
  });

  it('cache: segunda llamada al mismo ticker devuelve datos sin llamar a fetch', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => MOCK_OVERVIEW })
      .mockResolvedValueOnce({ json: async () => MOCK_BALANCE })
      .mockResolvedValueOnce({ json: async () => MOCK_CASHFLOW });

    // Importar una instancia fresca del handler para este test
    const { default: handler } = await import('./alpha.js?fresh=' + Math.random());

    const res1 = makeRes();
    await handler(makeReq('GOOG'), res1);
    expect(res1._status).toBe(200);

    // Segunda llamada: fetch no debe dispararse de nuevo
    const res2 = makeRes();
    await handler(makeReq('GOOG'), res2);
    expect(res2._status).toBe(200);

    // fetch llamado exactamente 3 veces (solo para la primera solicitud)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res2._body).toEqual(res1._body);
  });
});
