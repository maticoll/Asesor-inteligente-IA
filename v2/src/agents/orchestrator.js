/**
 * orchestrator.js — Agente Orquestador con LLM (Claude)
 *
 * runOrchestratorAgent(techResult, fundResult, riskResult, profile, onStatus) → OrchestratorResult
 *
 * Lógica basada en INVESTIGACION_CRITERIOS_INVERSION.md:
 *   - Parte D.3: ponderación por horizonte (corto/medio/largo)
 *   - Parte E.3 caso A: veto fundamental a largo plazo
 *   - Parte E.5: HOLD de primera clase; ≥2 confirmaciones para no-HOLD
 *   - Guardarraíl duro: portfolio_weight ≤ risk.max_weight_pct (en código, no en LLM)
 */

// ── Pesos por horizonte (Tabla D.3) ──────────────────────────────────────────
const AGENT_WEIGHTS = {
  short:  { technical: 0.60, fundamental: 0.15, risk: 0.25 },
  medium: { technical: 0.40, fundamental: 0.35, risk: 0.25 },
  long:   { technical: 0.15, fundamental: 0.60, risk: 0.25 },
};

// ── System prompt del orquestador ────────────────────────────────────────────
export const SYSTEM_PROMPT = `Eres el orquestador de un sistema de asesoría de inversiones.
Recibes los resultados de tres agentes especializados (técnico, fundamental, riesgo), el perfil
del inversor y el precio actual de la acción. Tu tarea es sintetizar una recomendación personalizada
y justificada.

IMPORTANTE: Este sistema produce INFORMACIÓN para la decisión del usuario, NO asesoría financiera,
y NO ejecuta órdenes. Aclararlo siempre en justification_multicriteria.

───────────────────────────────────────────────
PONDERACIÓN POR HORIZONTE DEL INVERSOR (Tabla D.3)
───────────────────────────────────────────────
- corto (short):  técnico 0.60 | fundamental 0.15 | riesgo 0.25
- medio (medium): técnico 0.40 | fundamental 0.35 | riesgo 0.25
- largo (long):   técnico 0.15 | fundamental 0.60 | riesgo 0.25

───────────────────────────────────────────────
REGLAS OBLIGATORIAS
───────────────────────────────────────────────

1. VETO FUNDAMENTAL A LARGO PLAZO (Parte E.3, Caso A):
   Si el horizonte es "long" y el agente fundamental tiene señal "sell" o score < -0.10,
   la recomendación máxima es "hold" (no "buy"). Excepción: si el técnico muestra un
   cambio estructural muy fuerte (score > 0.60 en uptrend confirmado), puedes salir del veto,
   pero DEBES explicarlo explícitamente en la justificación.

2. CONFIRMACIÓN MÍNIMA (Parte E.3):
   Para recomendar "buy" o "sell", exige señales alineadas de al menos 2 familias de análisis
   distintas (técnico, fundamental, riesgo). Si hay conflicto o menos de 2 señales alineadas,
   recomienda "hold" o baja la confianza significativamente (< 50).

3. HOLD DE PRIMERA CLASE (Parte E.5):
   "hold" es una decisión legítima, no un fallback. Úsalo cuando:
   - Hay contradicción entre señales
   - Baja confirmación (< 2 familias alineadas)
   - El régimen técnico es ambiguo (range)
   - Falta información de algún agente
   En estos casos, pon contradiction_detected: true y confidence_score < 50.

4. GUARDARRAÍL DE PESO:
   portfolio_weight debe ser <= max_weight_pct del agente de riesgo.
   Si no hay datos de riesgo, usa un máximo de 5%.

5. COHERENCIA DE PRECIOS (OBLIGATORIO):
   El contexto incluye "PRECIO ACTUAL (currentPrice)". Usá ese valor como ancla:
   - price_target debe estar entre currentPrice × 0.90 y currentPrice × 2.0 para una posición
     típica (ajustá según horizonte y volatilidad del agente técnico).
   - stop_loss debe estar por DEBAJO de currentPrice y dentro de un rango razonable dado por
     la volatilidad anualizada (ej. currentPrice × (1 − volatilidad_anualizada × 0.5) como piso).
   - Si currentPrice es null o los datos son insuficientes, devuelve null en ambos campos.

6. AGENTES NO DISPONIBLES:
   Si un agente reporta error o datos ausentes, reduce confidence_score en 15 puntos
   por cada agente faltante y explícalo en la justificación.

───────────────────────────────────────────────
FORMATO DE SALIDA — JSON ESTRICTO
───────────────────────────────────────────────
Devuelve UNICAMENTE un JSON válido, sin texto antes ni después, sin bloques de código markdown.
El JSON debe tener exactamente estos campos:

{
  "final_action": "buy" | "sell" | "hold",
  "confidence_score": número entre 0 y 100,
  "horizon": "short" | "medium" | "long",
  "price_target": número o null,
  "stop_loss": número o null,
  "portfolio_weight": número entre 0 y 20,
  "contradiction_detected": true | false,
  "agent_weights": {
    "technical": número,
    "fundamental": número,
    "risk": número
  },
  "justification_multicriteria": "texto en español explicando el razonamiento multi-criterio, las señales de cada agente, el peso aplicado según el horizonte, y el disclaimer de que es información y no asesoría financiera"
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/** Construye el mensaje de usuario con el contexto de los 3 agentes (exportado para tests) */
export function buildUserMessageForTest(techResult, fundResult, riskResult, profile, currentPrice) {
  return buildUserMessage(techResult, fundResult, riskResult, profile, currentPrice);
}

function buildUserMessage(techResult, fundResult, riskResult, profile, currentPrice) {
  const lines = [];
  lines.push('=== PERFIL DEL INVERSOR ===');
  lines.push(JSON.stringify({
    capital:      profile?.capital ?? null,
    risk_profile: profile?.risk_profile ?? 'moderate',
    horizon:      profile?.horizon ?? 'medium',
  }, null, 2));

  lines.push('\n=== PRECIO ACTUAL (currentPrice) ===');
  lines.push(currentPrice != null ? String(currentPrice) : 'null — no disponible');

  lines.push('\n=== RESULTADO AGENTE TÉCNICO ===');
  if (techResult && !techResult._error) {
    // Excluir closes[] — el LLM no necesita la serie completa de precios
    const { closes: _closes, ...techForLLM } = techResult;
    lines.push(JSON.stringify(techForLLM, null, 2));
  } else {
    lines.push('ERROR: el agente técnico no está disponible. ' +
      (techResult?._error || 'Datos ausentes.'));
  }

  lines.push('\n=== RESULTADO AGENTE FUNDAMENTAL ===');
  if (fundResult && !fundResult._error) {
    lines.push(JSON.stringify(fundResult, null, 2));
  } else {
    lines.push('ERROR: el agente fundamental no está disponible. ' +
      (fundResult?._error || 'Datos ausentes.'));
  }

  lines.push('\n=== RESULTADO AGENTE DE RIESGO ===');
  if (riskResult && !riskResult._error) {
    lines.push(JSON.stringify(riskResult, null, 2));
  } else {
    lines.push('ERROR: el agente de riesgo no está disponible. ' +
      (riskResult?._error || 'Datos ausentes.'));
  }

  lines.push('\n=== INSTRUCCIÓN ===');
  lines.push('Con los datos anteriores, genera la recomendación en el formato JSON especificado.');
  lines.push('Recuerda: devuelve SOLO JSON válido, sin texto fuera del JSON.');

  return lines.join('\n');
}

/** Extrae JSON del texto del LLM (intenta parseo directo, luego regex) */
function extractJSON(text) {
  // Intento 1: parseo directo
  try {
    return JSON.parse(text.trim());
  } catch (_) {}

  // Intento 2: extraer bloque {...} con regex
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
  }

  return null;
}

/** Resultado fallback cuando el LLM no responde correctamente */
function fallbackResult(profile, riskResult) {
  const horizon = profile?.horizon ?? 'medium';
  return {
    final_action:              'hold',
    confidence_score:          30,
    horizon,
    price_target:              null,
    stop_loss:                 null,
    portfolio_weight:          0,
    contradiction_detected:    true,
    agent_weights:             AGENT_WEIGHTS[horizon] ?? AGENT_WEIGHTS.medium,
    justification_multicriteria:
      'No se pudo obtener recomendación del orquestador. ' +
      'Se recomienda mantener (hold) con confianza mínima hasta obtener un análisis válido. ' +
      'Este es un resultado de seguridad, no asesoría financiera.',
  };
}

/** Valida y normaliza el resultado del LLM */
function normalizeResult(raw, profile, riskResult) {
  const horizon = profile?.horizon ?? 'medium';

  // final_action
  const validActions = ['buy', 'sell', 'hold'];
  if (!validActions.includes(raw.final_action)) {
    raw.final_action = 'hold';
  }

  // confidence_score
  raw.confidence_score = clamp(Number(raw.confidence_score) || 30, 0, 100);

  // horizon
  if (!['short', 'medium', 'long'].includes(raw.horizon)) {
    raw.horizon = horizon;
  }

  // price_target / stop_loss — solo números o null
  raw.price_target = (raw.price_target != null && isFinite(raw.price_target))
    ? Number(raw.price_target) : null;
  raw.stop_loss = (raw.stop_loss != null && isFinite(raw.stop_loss))
    ? Number(raw.stop_loss) : null;

  // portfolio_weight — clamp y guardarraíl duro
  raw.portfolio_weight = clamp(Number(raw.portfolio_weight) || 0, 0, 100);
  if (riskResult?.max_weight_pct != null) {
    raw.portfolio_weight = Math.min(raw.portfolio_weight, riskResult.max_weight_pct);
  } else {
    raw.portfolio_weight = Math.min(raw.portfolio_weight, 5);  // fallback máximo 5%
  }

  // contradiction_detected
  raw.contradiction_detected = Boolean(raw.contradiction_detected);

  // agent_weights — siempre inyectar desde código (no confiar en el LLM)
  raw.agent_weights = AGENT_WEIGHTS[horizon] ?? AGENT_WEIGHTS.medium;

  // justification_multicriteria
  if (typeof raw.justification_multicriteria !== 'string' || !raw.justification_multicriteria) {
    raw.justification_multicriteria = 'Justificación no disponible.';
  }

  return raw;
}

// ── Llamada a la API de Claude ────────────────────────────────────────────────

async function callClaude(messages, maxTokens = 2048) {
  // Ruta directa si hay API key en window.ENV (dev/testing)
  const directKey =
    (typeof window !== 'undefined') && window.ENV?.ANTHROPIC_API_KEY;

  if (directKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         directKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system:     SYSTEM_PROMPT,
        messages,
      }),
    });
    return res.json();
  }

  // Ruta normal: proxy /api/claude
  const res = await fetch('/api/claude', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: SYSTEM_PROMPT, messages, max_tokens: maxTokens }),
  });
  return res.json();
}

// ── Agente principal ──────────────────────────────────────────────────────────

/**
 * @param {object} techResult    - Salida de runTechnicalAgent (o null si error)
 * @param {object} fundResult    - Salida de runFundamentalAgent (o null si error)
 * @param {object} riskResult    - Salida de runRiskAgent
 * @param {object} profile       - { capital, risk_profile, horizon }
 * @param {function} [onStatus]
 * @param {number|null} [currentPrice] - Último precio de cierre de Yahoo Finance
 * @returns {Promise<OrchestratorResult>}
 */
export async function runOrchestratorAgent(
  techResult,
  fundResult,
  riskResult,
  profile = {},
  onStatus = () => {},
  currentPrice = null,
) {
  onStatus('Consultando al orquestador...');

  const userContent = buildUserMessage(techResult, fundResult, riskResult, profile, currentPrice);
  const messages    = [{ role: 'user', content: userContent }];

  let raw = null;

  // ── Intento 1 ───────────────────────────────────────────────────────────────
  try {
    const response = await callClaude(messages);
    const text = response?.content?.[0]?.text ?? '';
    raw = extractJSON(text);
  } catch (err) {
    onStatus(`Error en intento 1: ${err.message}`);
  }

  // ── Reintento si el JSON vino malformado ────────────────────────────────────
  if (raw == null) {
    onStatus('Reintentando (JSON malformado en intento 1)...');
    try {
      const retryMessages = [
        ...messages,
        {
          role: 'assistant',
          content: 'Mi respuesta anterior no fue JSON válido. Lo corrijo ahora.',
        },
        {
          role: 'user',
          content: 'Responde SOLO con el JSON válido, sin texto adicional, sin markdown.',
        },
      ];
      const response2 = await callClaude(retryMessages);
      const text2 = response2?.content?.[0]?.text ?? '';
      raw = extractJSON(text2);
    } catch (err) {
      onStatus(`Error en reintento: ${err.message}`);
    }
  }

  // ── Fallback si ambos intentos fallaron ─────────────────────────────────────
  if (raw == null) {
    onStatus('Orquestador no disponible — usando resultado de seguridad.');
    return fallbackResult(profile, riskResult);
  }

  // ── Normalizar y aplicar guardarraíles ──────────────────────────────────────
  const result = normalizeResult(raw, profile, riskResult);

  onStatus('Recomendación del orquestador lista.');
  return result;
}
