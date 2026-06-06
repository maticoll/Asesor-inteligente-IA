/**
 * api/yahoo.js — Proxy server-side para Yahoo Finance
 * Normaliza la respuesta al contrato definido en PLAN_EJECUCION_CLAUDE_CODE.md
 *
 * GET /api/yahoo?ticker=AAPL
 *
 * Salida:
 * { ticker, currency, closes[], highs[], lows[], volumes[], dates[], currentPrice }
 */

const TIMEOUT_MS = 8000;

function epochToDateStr(epoch) {
  return new Date(epoch * 1000).toISOString().split('T')[0];
}

// Filtra nulls aislados en un array paralelo usando el array de cierre como referencia
function filterNulls(closes, ...arrays) {
  const validIdx = closes.map((v, i) => (v != null ? i : null)).filter((i) => i !== null);
  return [closes, ...arrays].map((arr) => validIdx.map((i) => arr[i]));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker) {
    return res.status(400).json({ error: 'Falta parámetro: ticker' });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;

  let upstream;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; mvp-investment-advisor/2.0)',
      },
    });
    clearTimeout(timeoutId);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Yahoo Finance timeout' });
    }
    return res.status(502).json({ error: `Yahoo Finance proxy error: ${err.message}` });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return res.status(502).json({ error: 'Yahoo Finance devolvió respuesta no válida' });
  }

  // Validar estructura de la respuesta
  const result = data?.chart?.result?.[0];
  if (!result || data?.chart?.error) {
    return res.status(404).json({ error: 'ticker not found' });
  }

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};

  if (!timestamps.length) {
    return res.status(404).json({ error: 'ticker not found' });
  }

  // Extraer arrays OHLCV
  const rawCloses  = quote.close  || [];
  const rawHighs   = quote.high   || [];
  const rawLows    = quote.low    || [];
  const rawVolumes = quote.volume || [];
  const rawDates   = timestamps.map(epochToDateStr);

  // Filtrar filas donde el cierre es null (feriados, datos faltantes)
  const [closes, highs, lows, volumes, dates] = filterNulls(
    rawCloses, rawHighs, rawLows, rawVolumes, rawDates
  );

  const currentPrice =
    meta.regularMarketPrice ??
    meta.chartPreviousClose ??
    closes[closes.length - 1] ??
    null;

  return res.status(200).json({
    ticker,
    currency: meta.currency || 'USD',
    closes,
    highs,
    lows,
    volumes,
    dates,
    currentPrice,
  });
}
