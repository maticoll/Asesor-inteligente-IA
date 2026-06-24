/**
 * api/alpha.js — Proxy server-side para Alpha Vantage
 * Normaliza la respuesta al contrato definido en PLAN_EJECUCION_CLAUDE_CODE.md
 *
 * GET /api/alpha?ticker=AAPL
 *
 * Salida:
 * { ticker, sector, pe_trailing, pe_forward, roe, peg, eps_growth,
 *   fcf, fcf_yield, debt_to_equity, beta, market_cap }
 *
 * Notas de normalización:
 * - ReturnOnEquityTTM y QuarterlyEarningsGrowthYOY vienen como fracción directa.
 * - fcf = operatingCashflow - capitalExpenditures (CASH_FLOW anual[0]).
 * - debt_to_equity = totalLiabilities / totalShareholderEquity (BALANCE_SHEET anual[0]).
 * - Cache en memoria por ticker, ~12 h de validez (los fundamentales no cambian intradiario).
 * - Si BALANCE_SHEET o CASH_FLOW fallan/rate-limit, devuelven null sin romper el flujo.
 * Ref: INVESTIGACION_CRITERIOS_INVERSION.md — Parte B
 */

import { enforceRateLimit } from './_ratelimit.js';
import { applyCors, requireAuth } from './_auth.js';

// ── Cache en memoria ───────────────────────────────────────────────────────────

const CACHE = new Map();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

function cacheGet(ticker) {
  const entry = CACHE.get(ticker);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    CACHE.delete(ticker);
    return null;
  }
  return entry.data;
}

function cacheSet(ticker, data) {
  CACHE.set(ticker, { ts: Date.now(), data });
}

// ── Helpers de parseo ──────────────────────────────────────────────────────────

function parseNum(val) {
  if (val == null || val === 'None' || val === '-' || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseInt10(val) {
  if (val == null || val === 'None' || val === '-' || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function isRateLimited(raw) {
  return !!(raw?.Note || raw?.Information);
}

// ── Funciones puras de cálculo (exportadas para tests) ────────────────────────

/**
 * FCF = operatingCashflow - capitalExpenditures del reporte anual más reciente.
 * Devuelve null si faltan campos o el reporte está vacío.
 */
export function calcFCF(cashReport) {
  if (!cashReport || typeof cashReport !== 'object') return null;
  const op  = parseNum(cashReport.operatingCashflow);
  const cap = parseNum(cashReport.capitalExpenditures);
  if (op == null || cap == null) return null;
  return op - cap;
}

/**
 * D/E = totalLiabilities / totalShareholderEquity del balance anual más reciente.
 * Devuelve null si equity es 0, negativo o faltan campos.
 */
export function calcDebtToEquity(balanceReport) {
  if (!balanceReport || typeof balanceReport !== 'object') return null;
  const liabilities = parseNum(balanceReport.totalLiabilities);
  const equity      = parseNum(balanceReport.totalShareholderEquity);
  if (liabilities == null || equity == null || equity <= 0) return null;
  return liabilities / equity;
}

// ── Fetch con manejo de rate-limit ─────────────────────────────────────────────

async function safeFetch(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const json = await res.json();
    if (isRateLimited(json)) return { _rateLimited: true };
    return json;
  } catch {
    return { _error: true };
  }
}

// ── Handler principal ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Autenticación: solo usuarios con sesión válida pueden consultar fundamentales.
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker) {
    return res.status(400).json({ error: 'Falta parámetro: ticker' });
  }

  // Cache hit → devolver sin gastar API calls (no cuenta para el rate limit)
  const cached = cacheGet(ticker);
  if (cached) return res.status(200).json(cached);

  // Rate limit: protege la cuota free de Alpha Vantage (25/día) contra ráfagas.
  // 8 fetches reales por minuto y por IP.
  if (!enforceRateLimit(req, res, { bucket: 'alpha', limit: 8, windowMs: 60_000 })) return;

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ALPHA_VANTAGE_API_KEY no configurada en Vercel' });
  }

  const base = `https://www.alphavantage.co/query`;

  // Por defecto SOLO OVERVIEW (1 request) para no agotar el free tier de Alpha Vantage
  // (25/día y 5/min). Hacer 3 llamadas por análisis lo agota en ~8 análisis y dispara 429.
  // BALANCE_SHEET y CASH_FLOW (necesarias para D/E y FCF) se activan con ALPHA_DEEP=1,
  // recomendado solo con un plan pago de Alpha Vantage.
  const deep = process.env.ALPHA_DEEP === '1';
  const overview = await safeFetch(`${base}?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`);
  const [balance, cashflow] = deep
    ? await Promise.all([
        safeFetch(`${base}?function=BALANCE_SHEET&symbol=${ticker}&apikey=${apiKey}`),
        safeFetch(`${base}?function=CASH_FLOW&symbol=${ticker}&apikey=${apiKey}`),
      ])
    : [null, null];

  // OVERVIEW es obligatorio: si falla o rate-limit, devolver error
  if (overview._error) {
    return res.status(502).json({ error: 'Alpha Vantage proxy error al llamar OVERVIEW' });
  }
  if (overview._rateLimited) {
    return res.status(429).json({ error: 'Alpha Vantage rate limit — intentá en 1 minuto' });
  }
  if (!overview?.Symbol) {
    return res.status(404).json({ error: 'ticker not found' });
  }

  const marketCap = parseInt10(overview.MarketCapitalization);

  // FCF y D/E: degradan a null si los endpoints auxiliares fallaron/rate-limited
  const balanceReport  = balance?.annualReports?.[0]  ?? null;
  const cashflowReport = cashflow?.annualReports?.[0] ?? null;

  const fcf            = calcFCF(cashflowReport);
  const debtToEquity   = calcDebtToEquity(balanceReport);
  const fcfYield       = (fcf != null && marketCap != null && marketCap > 0)
    ? fcf / marketCap
    : null;

  const result = {
    ticker,
    sector:         overview.Sector || null,
    pe_trailing:    parseNum(overview.TrailingPE) ?? parseNum(overview.PERatio),
    pe_forward:     parseNum(overview.ForwardPE),
    roe:            parseNum(overview.ReturnOnEquityTTM),
    peg:            parseNum(overview.PEGRatio),
    eps_growth:     parseNum(overview.QuarterlyEarningsGrowthYOY),
    fcf:            fcf,
    fcf_yield:      fcfYield,
    debt_to_equity: debtToEquity,
    beta:           parseNum(overview.Beta),
    market_cap:     marketCap,
  };

  cacheSet(ticker, result);
  return res.status(200).json(result);
}
