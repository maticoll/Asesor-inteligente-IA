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
 * - ReturnOnEquityTTM y QuarterlyEarningsGrowthYOY vienen como fracción directa
 *   (ej. "1.415" = ROE 141.5% para AAPL), no como porcentaje. Se pasan tal cual.
 * - fcf, fcf_yield y debt_to_equity no están disponibles en OVERVIEW (solo en
 *   BALANCE_SHEET / CASH_FLOW). Se devuelven como null, lo que el contrato permite.
 * - TrailingPE fallback a PERatio si no disponible.
 * - "None" o string vacío → null en todos los campos numéricos.
 * Ref: INVESTIGACION_CRITERIOS_INVERSION.md — Parte B
 */

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker) {
    return res.status(400).json({ error: 'Falta parámetro: ticker' });
  }

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ALPHA_VANTAGE_API_KEY no configurada en Vercel' });
  }

  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`;

  let raw;
  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    raw = await upstream.json();
  } catch (err) {
    return res.status(502).json({ error: `Alpha Vantage proxy error: ${err.message}` });
  }

  // Rate limit de Alpha Vantage
  if (raw?.Note || raw?.Information) {
    return res.status(429).json({ error: 'Alpha Vantage rate limit — intentá en 1 minuto' });
  }

  // Ticker no encontrado: Alpha devuelve {} vacío
  if (!raw?.Symbol) {
    return res.status(404).json({ error: 'ticker not found' });
  }

  const marketCap = parseInt10(raw.MarketCapitalization);

  // fcf, fcf_yield y debt_to_equity no están en OVERVIEW → null (permitido por contrato)
  return res.status(200).json({
    ticker,
    sector:         raw.Sector || null,
    pe_trailing:    parseNum(raw.TrailingPE) ?? parseNum(raw.PERatio),
    pe_forward:     parseNum(raw.ForwardPE),
    roe:            parseNum(raw.ReturnOnEquityTTM),            // fracción directa
    peg:            parseNum(raw.PEGRatio),
    eps_growth:     parseNum(raw.QuarterlyEarningsGrowthYOY),  // fracción directa
    fcf:            null,   // no disponible en OVERVIEW
    fcf_yield:      null,   // no disponible en OVERVIEW
    debt_to_equity: null,   // no disponible en OVERVIEW
    beta:           parseNum(raw.Beta),
    market_cap:     marketCap,
  });
}
