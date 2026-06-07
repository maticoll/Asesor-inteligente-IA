/**
 * sectors.js — Medianas de fundamentales por sector
 *
 * Tabla anclada en Damodaran (NYU Stern, Ene-2026).
 * Ref: INVESTIGACION_CRITERIOS_INVERSION.md — Parte B, sección B.1 y B.3
 * Fuente primaria: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/pedata.html
 *
 * Métricas disponibles:
 *   pe  — P/E trailing mediano del sector
 *   peg — PEG ratio mediano del sector
 *
 * "_market" es el fallback cuando el sector no está en la tabla.
 * Los sectores de Alpha Vantage vienen en mayúsculas; se normalizan al comparar.
 */

const SECTOR_DATA = {
  // ── Alta valoración (tech / growth) ──────────────────────────────────────
  'Technology':               { pe: 79,  peg: 1.9 },
  'Semiconductors':           { pe: 100, peg: 1.5 },
  'Software':                 { pe: 79,  peg: 2.2 },
  'Information Technology':   { pe: 79,  peg: 1.9 },

  // ── Salud ─────────────────────────────────────────────────────────────────
  'Healthcare':               { pe: 35,  peg: 1.8 },
  'Biotechnology':            { pe: 64,  peg: 2.0 },
  'Pharmaceuticals':          { pe: 20,  peg: 1.5 },

  // ── Consumo ───────────────────────────────────────────────────────────────
  'Consumer Cyclical':        { pe: 22,  peg: 1.4 },
  'Consumer Defensive':       { pe: 22,  peg: 2.0 },
  'Consumer Staples':         { pe: 22,  peg: 2.0 },
  'Retail':                   { pe: 25,  peg: 1.5 },

  // ── Servicios ─────────────────────────────────────────────────────────────
  'Communication Services':   { pe: 20,  peg: 1.6 },
  'Media':                    { pe: 18,  peg: 1.5 },

  // ── Industriales / Materiales ────────────────────────────────────────────
  'Industrials':              { pe: 22,  peg: 1.5 },
  'Materials':                { pe: 18,  peg: 1.3 },

  // ── Financiero ───────────────────────────────────────────────────────────
  'Financial Services':       { pe: 15,  peg: 1.2 },
  'Finance':                  { pe: 15,  peg: 1.2 },
  'Banking':                  { pe: 15,  peg: 1.2 },
  'Insurance':                { pe: 13,  peg: 1.1 },

  // ── Real Estate / Utilities ──────────────────────────────────────────────
  'Real Estate':              { pe: 40,  peg: 2.5 },
  'Utilities':                { pe: 20,  peg: 2.5 },

  // ── Energía ───────────────────────────────────────────────────────────────
  'Energy':                   { pe: 12,  peg: 1.0 },
  'Oil & Gas':                { pe: 12,  peg: 1.0 },

  // ── Fallback de mercado ───────────────────────────────────────────────────
  '_market':                  { pe: 25,  peg: 1.9 },
};

/**
 * Devuelve la mediana del sector para una métrica dada.
 * Si el sector no está en la tabla, usa el fallback "_market".
 *
 * @param {string} sector - Nombre del sector (case-insensitive)
 * @param {'pe' | 'peg'} metric
 * @returns {number}
 */
export function sectorMedian(sector, metric) {
  if (!sector || !metric) return SECTOR_DATA['_market'][metric] ?? null;

  // Normalizar: Title Case, sin acentos, recortar espacios
  const normalized = sector.trim();

  // Búsqueda exacta primero (case-insensitive)
  const key = Object.keys(SECTOR_DATA).find(
    (k) => k.toLowerCase() === normalized.toLowerCase()
  );

  const entry = key ? SECTOR_DATA[key] : SECTOR_DATA['_market'];
  return entry?.[metric] ?? SECTOR_DATA['_market'][metric] ?? null;
}

/**
 * Devuelve el objeto completo de métricas para un sector.
 * Útil para el agente fundamental.
 */
export function sectorData(sector) {
  const normalized = (sector || '').trim();
  const key = Object.keys(SECTOR_DATA).find(
    (k) => k.toLowerCase() === normalized.toLowerCase()
  );
  return key ? SECTOR_DATA[key] : SECTOR_DATA['_market'];
}
