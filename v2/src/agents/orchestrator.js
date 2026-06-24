/**
 * orchestrator.js — Agente Orquestador HÍBRIDO
 *
 * Determinístico en la DECISIÓN: final_action, confianza, price_target, stop_loss y
 * portfolio_weight se calculan en código (decideAction), a partir de los scores de los
 * tres agentes, los pesos por horizonte y reglas explícitas.
 *
 * Generativo solo en la EXPLICACIÓN: el LLM (Claude) recibe la decisión ya tomada y
 * redacta resumen_usuario y justification_multicriteria. NO puede cambiar la decisión.
 * Si el LLM falla, se usa una explicación determinística de respaldo.
 *
 * Lógica basada en INVESTIGACION_CRITERIOS_INVERSION.md:
 *   - D.3: ponderación por horizonte | E.3: veto fundamental + confirmación mínima
 *   - E.5: HOLD de primera clase | Guardarraíl de peso ≤ max_weight_pct
 */

// ── Pesos por horizonte (Tabla D.3) ──────────────────────────────────────────
const AGENT_WEIGHTS = {
  short:  { technical: 0.60, fundamental: 0.15, risk: 0.25 },
  medium: { technical: 0.40, fundamental: 0.35, risk: 0.25 },
  long:   { technical: 0.15, fundamental: 0.60, risk: 0.25 },
};

const DECISION_THRESHOLD = 0.12; // |score combinado| para salir de HOLD

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dir(signal) { return signal === 'buy' ? 1 : signal === 'sell' ? -1 : 0; }

// ── DECISIÓN DETERMINÍSTICA ───────────────────────────────────────────────────

/**
 * Calcula la recomendación final SIN usar el LLM. Exportada para tests.
 * @returns {object} decisión con final_action, confidence_score, etc. + metadata interna (_*)
 */
export function decideAction(techResult, fundResult, riskResult, profile = {}, currentPrice = null) {
  const horizon = ['short', 'medium', 'long'].includes(profile?.horizon) ? profile.horizon : 'medium';
  const weights = AGENT_WEIGHTS[horizon];

  const hasTech = techResult && !techResult._error;
  const hasFund = fundResult && !fundResult._error;
  const hasRisk = riskResult && !riskResult._error;

  const techScore = hasTech ? (techResult.score ?? 0) : 0;
  const fundScore = hasFund ? (fundResult.score ?? 0) : 0;
  const riskScore = hasRisk ? (riskResult.score ?? 0) : 0;

  // Score combinado ponderado por horizonte.
  // Técnico y fundamental son direccionales (−1..+1); el riesgo penaliza (score ≤ 0 si es alto).
  const combined = weights.technical * techScore
                 + weights.fundamental * fundScore
                 + weights.risk * riskScore;

  const techDir = hasTech ? dir(techResult.signal) : 0;
  const fundDir = hasFund ? dir(fundResult.signal) : 0;
  const riskLevel = hasRisk ? riskResult.risk_level : 'medium';

  // Contradicción: técnico y fundamental apuntan a direcciones opuestas.
  const contradiction = (techDir > 0 && fundDir < 0) || (techDir < 0 && fundDir > 0);

  // Confirmación mínima: nº de familias alineadas en cada dirección (E.3).
  const bullishFamilies = (techDir > 0 ? 1 : 0) + (fundDir > 0 ? 1 : 0) + (riskLevel === 'low' ? 1 : 0);
  const bearishFamilies = (techDir < 0 ? 1 : 0) + (fundDir < 0 ? 1 : 0) + (riskLevel === 'high' ? 1 : 0);

  const reasons = [];
  let action = 'hold';

  if (combined > DECISION_THRESHOLD && bullishFamilies >= 2 && !contradiction) {
    action = 'buy';
    reasons.push(`Score combinado +${combined.toFixed(2)} > ${DECISION_THRESHOLD} con ${bullishFamilies} familias alcistas alineadas.`);
  } else if (combined < -DECISION_THRESHOLD && bearishFamilies >= 2 && !contradiction) {
    action = 'sell';
    reasons.push(`Score combinado ${combined.toFixed(2)} < -${DECISION_THRESHOLD} con ${bearishFamilies} familias bajistas alineadas.`);
  } else {
    action = 'hold';
    if (contradiction) reasons.push('Técnico y fundamental se contradicen → HOLD de primera clase (E.5).');
    else if (Math.abs(combined) <= DECISION_THRESHOLD) reasons.push(`Score combinado ${combined.toFixed(2)} en zona neutral (±${DECISION_THRESHOLD}) → HOLD.`);
    else reasons.push('Sin confirmación mínima (≥2 familias alineadas) → HOLD.');
  }

  // Veto fundamental a largo plazo (E.3, Caso A).
  let vetoApplied = false;
  if (horizon === 'long' && hasFund && (fundResult.signal === 'sell' || fundScore < -0.10)) {
    const strongTech = hasTech && techScore > 0.60 && techResult.regime === 'uptrend';
    if (action === 'buy' && !strongTech) {
      action = 'hold';
      vetoApplied = true;
      reasons.push('Veto fundamental a largo plazo: fundamental bajista limita la recomendación a HOLD.');
    } else if (action === 'buy' && strongTech) {
      reasons.push('Veto fundamental superado por cambio estructural técnico muy fuerte (score>0.60 en uptrend).');
    }
  }

  // Confianza determinística.
  const missing = (hasTech ? 0 : 1) + (hasFund ? 0 : 1) + (hasRisk ? 0 : 1);
  let confidence = 50 + Math.round(Math.abs(combined) * 40);
  if (action !== 'hold') confidence += 5;
  if (contradiction) confidence = Math.min(confidence, 45);
  confidence -= missing * 15;
  const agentConfs = [hasTech && techResult.confidence, hasFund && fundResult.confidence].filter((x) => typeof x === 'number');
  if (agentConfs.length) {
    const avg = agentConfs.reduce((a, b) => a + b, 0) / agentConfs.length;
    confidence = Math.round(0.6 * confidence + 0.4 * avg);
  }
  confidence = clamp(confidence, 5, 95);

  // Guardarraíl de peso: ≤ max_weight_pct; escala con la confianza; 0 si no es buy.
  const maxW = (hasRisk && riskResult.max_weight_pct != null) ? riskResult.max_weight_pct : 5;
  let portfolio_weight = 0;
  if (action === 'buy') {
    portfolio_weight = parseFloat(Math.min(maxW * (confidence / 100), maxW).toFixed(2));
  }

  // price_target / stop_loss: solo en buy, anclados al precio actual y la volatilidad.
  let price_target = null;
  let stop_loss = null;
  const vol = hasTech ? (techResult.indicators?.volatility_annual ?? null) : null;
  if (action === 'buy' && currentPrice != null && isFinite(currentPrice)) {
    const horizonK = { short: 0.06, medium: 0.12, long: 0.20 }[horizon];
    const upside = horizonK + (vol != null ? Math.min(vol, 0.6) * 0.3 : 0.05);
    price_target = parseFloat((currentPrice * (1 + upside)).toFixed(2));
    const stopDrop = vol != null ? Math.min(vol * 0.5, 0.25) : 0.10;
    stop_loss = parseFloat((currentPrice * (1 - stopDrop)).toFixed(2));
  }

  return {
    final_action: action,
    confidence_score: confidence,
    horizon,
    price_target,
    stop_loss,
    portfolio_weight,
    contradiction_detected: contradiction,
    agent_weights: weights,
    // metadata interna para construir la explicación (no forma parte del contrato de salida)
    _combined: parseFloat(combined.toFixed(3)),
    _reasons: reasons,
    _veto_applied: vetoApplied,
    _missing: missing,
  };
}

// ── PROMPT DE EXPLICACIÓN (el LLM solo redacta, no decide) ─────────────────────

export const SYSTEM_PROMPT = `Eres el redactor de un sistema de asesoría de inversiones.
La DECISIÓN (comprar/mantener/vender y todos los números) YA FUE CALCULADA por reglas
determinísticas. Tu tarea NO es decidir ni cambiar nada: es EXPLICAR la decisión recibida
de forma clara y técnica. NO modifiques final_action, price_target, stop_loss,
portfolio_weight ni confidence_score: tomalos como dados.

IMPORTANTE: Este sistema produce INFORMACIÓN, NO asesoría financiera, y NO ejecuta órdenes.
Aclaralo siempre.

Devuelve ÚNICAMENTE un JSON válido (sin markdown, sin texto fuera del JSON) con EXACTAMENTE
estos dos campos:

{
  "resumen_usuario": "...",
  "justification_multicriteria": "..."
}

CÓMO ESCRIBIR "resumen_usuario" (lo que lee la persona):
- Empezá comunicando la decisión recibida en lenguaje cotidiano ("Te sugerimos comprar",
  "Conviene esperar por ahora", "Lo mejor sería vender"). "hold" = mantener/esperar.
- Explicá en pocas frases por qué, con ideas sencillas, SIN siglas ni números técnicos
  (nada de RSI, MACD, VaR, beta, PEG, scores ni pesos).
- Si hay contradicción entre señales, decilo con honestidad y tono tranquilo.
- 2 a 4 frases, tono amable, tratando de "vos"/"te".
- Cerrá SIEMPRE recordando que es información para ayudarte a decidir, no asesoría financiera.

CÓMO ESCRIBIR "justification_multicriteria" (técnico, para auditoría):
- Detallá las señales, scores y confianza de cada agente con sus valores concretos.
- Explicá el régimen técnico, los pesos por horizonte aplicados y cómo se combinaron.
- Mencioná explícitamente la regla que determinó la decisión (umbral, confirmación mínima,
  veto fundamental o contradicción) usando los números que la respaldan.
- Explicá el razonamiento de price_target, stop_loss y portfolio_weight respecto al precio actual.
- Cerrá con el disclaimer de que es información y no asesoría financiera.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Construye el mensaje para el LLM con la decisión YA tomada + datos de los agentes. */
function buildExplanationMessage(decision, techResult, fundResult, riskResult, profile, currentPrice) {
  const stripInternal = ({ _combined, _reasons, _veto_applied, _missing, ...pub }) => pub;
  const lines = [];

  lines.push('=== DECISIÓN YA CALCULADA (NO LA CAMBIES, solo explicala) ===');
  lines.push(JSON.stringify(stripInternal(decision), null, 2));

  lines.push('\n=== CÓMO SE LLEGÓ A LA DECISIÓN (reglas determinísticas) ===');
  lines.push(`score_combinado: ${decision._combined}`);
  lines.push(`razones: ${decision._reasons.join(' ')}`);

  lines.push('\n=== PERFIL DEL INVERSOR ===');
  lines.push(JSON.stringify({
    capital:      profile?.capital ?? null,
    risk_profile: profile?.risk_profile ?? 'moderate',
    horizon:      profile?.horizon ?? 'medium',
  }, null, 2));

  lines.push('\n=== PRECIO ACTUAL ===');
  lines.push(currentPrice != null ? String(currentPrice) : 'null — no disponible');

  lines.push('\n=== AGENTE TÉCNICO ===');
  lines.push(techResult && !techResult._error
    ? JSON.stringify((({ closes, ...t }) => t)(techResult), null, 2)
    : 'No disponible.');

  lines.push('\n=== AGENTE FUNDAMENTAL ===');
  lines.push(fundResult && !fundResult._error ? JSON.stringify(fundResult, null, 2) : 'No disponible.');

  lines.push('\n=== AGENTE DE RIESGO ===');
  lines.push(riskResult && !riskResult._error ? JSON.stringify(riskResult, null, 2) : 'No disponible.');

  lines.push('\n=== INSTRUCCIÓN ===');
  lines.push('Redactá resumen_usuario y justification_multicriteria para la decisión de arriba.');
  lines.push('Devolvé SOLO el JSON con esos dos campos.');

  return lines.join('\n');
}

/** Extrae { resumen_usuario, justification_multicriteria } del texto del LLM. */
function extractExplanation(text) {
  let obj = null;
  try { obj = JSON.parse(text.trim()); } catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (_) {} }
  }
  if (!obj) return null;
  const r = typeof obj.resumen_usuario === 'string' ? obj.resumen_usuario.trim() : '';
  const j = typeof obj.justification_multicriteria === 'string' ? obj.justification_multicriteria.trim() : '';
  if (!r && !j) return null;
  return {
    resumen_usuario: r || null,
    justification_multicriteria: j || null,
  };
}

/** Explicación determinística de respaldo (si el LLM no responde). */
function templateExplanation(decision, techResult, fundResult, riskResult) {
  const accion = { buy: 'comprar', sell: 'vender', hold: 'esperar por ahora' }[decision.final_action] ?? 'esperar por ahora';
  const resumen_usuario =
    `Según nuestro análisis, lo más razonable sería ${accion}. ` +
    (decision.contradiction_detected
      ? 'Las señales no son del todo claras, por eso preferimos ser prudentes. '
      : '') +
    'Recordá que esto es información para ayudarte a decidir, no una asesoría financiera.';

  const parts = [];
  if (techResult && !techResult._error) parts.push(`Técnico: ${techResult.justification}`);
  if (fundResult && !fundResult._error) parts.push(`Fundamental: ${fundResult.justification}`);
  if (riskResult && !riskResult._error) parts.push(`Riesgo: ${riskResult.justification}`);
  parts.push(
    `Decisión calculada en código: ${decision.final_action.toUpperCase()} ` +
    `(score combinado ${decision._combined}, confianza ${decision.confidence_score}%). ` +
    decision._reasons.join(' '),
  );
  if (decision.price_target != null) {
    parts.push(`Objetivo ${decision.price_target} / stop ${decision.stop_loss} / peso ${decision.portfolio_weight}%.`);
  }
  parts.push('Información, no asesoría financiera.');

  return { resumen_usuario, justification_multicriteria: parts.join(' ') };
}

// ── Llamada a la API de Claude ────────────────────────────────────────────────

async function callClaude(messages, maxTokens = 900, token = null) {
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

  // Ruta normal: proxy /api/claude (requiere token de sesión de Clerk)
  const res = await fetch('/api/claude', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
 * @param {string|null} [token]   - Token de sesión de Clerk para autenticar /api/claude
 * @returns {Promise<OrchestratorResult>}
 */
export async function runOrchestratorAgent(
  techResult,
  fundResult,
  riskResult,
  profile = {},
  onStatus = () => {},
  currentPrice = null,
  token = null,
) {
  // 1. DECISIÓN — 100% determinística, sin LLM.
  onStatus('Calculando recomendación...');
  const decision = decideAction(techResult, fundResult, riskResult, profile, currentPrice);

  // 2. EXPLICACIÓN — el LLM solo redacta (no puede cambiar la decisión).
  onStatus('Redactando explicación...');
  let explanation = null;
  try {
    const messages = [{
      role: 'user',
      content: buildExplanationMessage(decision, techResult, fundResult, riskResult, profile, currentPrice),
    }];
    const response = await callClaude(messages, 900, token);
    const text = response?.content?.[0]?.text ?? '';
    explanation = extractExplanation(text);
  } catch (err) {
    onStatus(`LLM no disponible para la explicación: ${err.message}`);
  }

  // 3. Respaldo determinístico si el LLM falló o vino incompleto.
  const fallback = templateExplanation(decision, techResult, fundResult, riskResult);
  const resumen_usuario = explanation?.resumen_usuario ?? fallback.resumen_usuario;
  const justification_multicriteria = explanation?.justification_multicriteria ?? fallback.justification_multicriteria;

  onStatus('Recomendación lista.');

  // Salida pública (sin la metadata interna _*).
  const { _combined, _reasons, _veto_applied, _missing, ...pub } = decision;
  return { ...pub, resumen_usuario, justification_multicriteria };
}
