import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runOrchestratorAgent, SYSTEM_PROMPT, buildUserMessageForTest } from './orchestrator.js';

// ── Datos de prueba ────────────────────────────────────────────────────────────

const TECH_BUY = {
  signal: 'buy', score: 0.45, confidence: 72,
  regime: 'uptrend',
  indicators: { rsi: 55, sma50: 180, sma200: 160, golden_cross: true },
  justification: 'RSI 55, uptrend confirmado, Golden Cross.',
  closes: [150, 155, 160, 165, 170],
};

const TECH_SELL = {
  signal: 'sell', score: -0.40, confidence: 68,
  regime: 'downtrend',
  indicators: { rsi: 42, sma50: 140, sma200: 160, golden_cross: false },
  justification: 'RSI 42, downtrend, Death Cross.',
  closes: [170, 165, 160, 155, 150],
};

const FUND_BUY = {
  signal: 'buy', score: 0.35, confidence: 75,
  valuation: 'cheap', quality_score: 72,
  metrics_vs_sector: { pe: { verdict: 'cheap' }, roe: { verdict: 'strong' }, peg: { verdict: 'cheap' } },
  beta: 1.1,
  justification: 'P/E bajo vs sector, ROE fuerte, PEG < 1.',
};

const FUND_SELL = {
  signal: 'sell', score: -0.35, confidence: 70,
  valuation: 'expensive', quality_score: 40,
  metrics_vs_sector: { pe: { verdict: 'expensive' }, roe: { verdict: 'weak' }, peg: { verdict: 'very_expensive' } },
  beta: 1.6,
  justification: 'P/E alto vs sector, ROE débil, PEG > 2.',
};

const RISK_LOW = {
  risk_level: 'low', score: 0.10,
  volatility_annual: 0.12, var_95_pct: 0.012, var_95_usd: 960,
  es_95_pct: 0.018, beta: 1.1, max_weight_pct: 8.0,
  justification: 'Volatilidad 12%, beta 1.1, moderado.',
};

const PROFILE_MEDIUM = { capital: 100000, risk_profile: 'moderate', horizon: 'medium' };
const PROFILE_LONG   = { capital: 100000, risk_profile: 'conservative', horizon: 'long' };

// ── Helper: construir respuesta mock de Claude ─────────────────────────────────

function makeCloudeResponse(json) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
  };
}

function makeClaudeResponseText(text) {
  return { content: [{ type: 'text', text }] };
}

// ── Setup/Teardown ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  // Asegurarse de que window.ENV no tenga API key (usar ruta /api/claude)
  if (typeof window !== 'undefined') {
    window.ENV = {};
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runOrchestratorAgent', () => {

  it('3 señales alineadas (buy) → final_action buy, JSON bien formado', async () => {
    const mockResponse = makeCloudeResponse({
      final_action:              'buy',
      confidence_score:          78,
      horizon:                   'medium',
      price_target:              185,
      stop_loss:                 158,
      portfolio_weight:          7,
      contradiction_detected:    false,
      agent_weights:             { technical: 0.40, fundamental: 0.35, risk: 0.25 },
      justification_multicriteria: 'Técnico buy (uptrend), fundamental cheap, riesgo low. Información, no asesoría.',
    });

    fetch.mockResolvedValue({ json: async () => mockResponse });

    const result = await runOrchestratorAgent(
      TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_MEDIUM,
    );

    expect(result.final_action).toBe('buy');
    expect(result.confidence_score).toBeGreaterThan(50);
    expect(result.contradiction_detected).toBe(false);
    expect(result.portfolio_weight).toBeLessThanOrEqual(RISK_LOW.max_weight_pct);
  });

  it('técnico buy + fundamental sell + horizonte largo → hold o contradiction_detected', async () => {
    const mockResponse = makeCloudeResponse({
      final_action:              'hold',
      confidence_score:          35,
      horizon:                   'long',
      price_target:              null,
      stop_loss:                 null,
      portfolio_weight:          0,
      contradiction_detected:    true,
      agent_weights:             { technical: 0.15, fundamental: 0.60, risk: 0.25 },
      justification_multicriteria: 'Técnico buy pero fundamental sell en horizonte largo. Veto fundamental aplicado. HOLD.',
    });

    fetch.mockResolvedValue({ json: async () => mockResponse });

    const result = await runOrchestratorAgent(
      TECH_BUY, FUND_SELL, RISK_LOW, PROFILE_LONG,
    );

    // Con veto fundamental en largo plazo, no debe ser buy
    expect(result.final_action).not.toBe('buy');
    expect(result.contradiction_detected).toBe(true);
  });

  it('agente fundamental null → degrada con elegancia, no crash', async () => {
    const mockResponse = makeCloudeResponse({
      final_action:              'hold',
      confidence_score:          45,
      horizon:                   'medium',
      price_target:              null,
      stop_loss:                 null,
      portfolio_weight:          4,
      contradiction_detected:    false,
      agent_weights:             { technical: 0.40, fundamental: 0.35, risk: 0.25 },
      justification_multicriteria: 'Agente fundamental no disponible. Confianza reducida.',
    });

    fetch.mockResolvedValue({ json: async () => mockResponse });

    let result;
    expect(async () => {
      result = await runOrchestratorAgent(TECH_BUY, null, RISK_LOW, PROFILE_MEDIUM);
    }).not.toThrow();

    result = await runOrchestratorAgent(TECH_BUY, null, RISK_LOW, PROFILE_MEDIUM);
    expect(result).toHaveProperty('final_action');
    expect(result).toHaveProperty('confidence_score');
    expect(['buy', 'sell', 'hold']).toContain(result.final_action);
  });

  it('guardarraíl de peso: LLM devuelve portfolio_weight=15 pero max_weight_pct=5 → resultado 5', async () => {
    const mockResponse = makeCloudeResponse({
      final_action:              'buy',
      confidence_score:          70,
      horizon:                   'medium',
      price_target:              180,
      stop_loss:                 155,
      portfolio_weight:          15,  // LLM sugiere 15%
      contradiction_detected:    false,
      agent_weights:             { technical: 0.40, fundamental: 0.35, risk: 0.25 },
      justification_multicriteria: 'Buy con señales alineadas.',
    });

    fetch.mockResolvedValue({ json: async () => mockResponse });

    const riskWithLowWeight = { ...RISK_LOW, max_weight_pct: 5 };
    const result = await runOrchestratorAgent(
      TECH_BUY, FUND_BUY, riskWithLowWeight, PROFILE_MEDIUM,
    );

    // Guardarraíl duro: nunca superar max_weight_pct
    expect(result.portfolio_weight).toBeLessThanOrEqual(5);
    expect(result.portfolio_weight).toBe(5);
  });

  it('JSON malformado en 1er intento, válido en reintento → éxito', async () => {
    const validResponse = makeCloudeResponse({
      final_action:              'hold',
      confidence_score:          55,
      horizon:                   'medium',
      price_target:              null,
      stop_loss:                 null,
      portfolio_weight:          6,
      contradiction_detected:    false,
      agent_weights:             { technical: 0.40, fundamental: 0.35, risk: 0.25 },
      justification_multicriteria: 'Señales mixtas. HOLD.',
    });

    // 1er llamada: devuelve texto no-JSON; 2da y 3ra: devuelven JSON válido
    fetch
      .mockResolvedValueOnce({ json: async () => makeClaudeResponseText('esto no es json válido') })
      .mockResolvedValue({ json: async () => validResponse });

    const result = await runOrchestratorAgent(TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_MEDIUM);

    expect(result.final_action).toBe('hold');
    expect(result.confidence_score).toBe(55);
  });

  it('contrato completo: todos los campos presentes', async () => {
    const mockResponse = makeCloudeResponse({
      final_action:              'buy',
      confidence_score:          65,
      horizon:                   'medium',
      price_target:              178,
      stop_loss:                 160,
      portfolio_weight:          7,
      contradiction_detected:    false,
      agent_weights:             { technical: 0.40, fundamental: 0.35, risk: 0.25 },
      justification_multicriteria: 'Tres señales alineadas al alza. Información, no asesoría.',
    });

    fetch.mockResolvedValue({ json: async () => mockResponse });

    const result = await runOrchestratorAgent(TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_MEDIUM);

    expect(result).toHaveProperty('final_action');
    expect(result).toHaveProperty('confidence_score');
    expect(result).toHaveProperty('horizon');
    expect(result).toHaveProperty('price_target');
    expect(result).toHaveProperty('stop_loss');
    expect(result).toHaveProperty('portfolio_weight');
    expect(result).toHaveProperty('contradiction_detected');
    expect(result).toHaveProperty('agent_weights');
    expect(result.agent_weights).toHaveProperty('technical');
    expect(result.agent_weights).toHaveProperty('fundamental');
    expect(result.agent_weights).toHaveProperty('risk');
    expect(result).toHaveProperty('justification_multicriteria');

    // agent_weights deben sumar ~1 (inyectados por código, no por LLM)
    const { technical, fundamental, risk } = result.agent_weights;
    expect(technical + fundamental + risk).toBeCloseTo(1, 5);
  });

  it('ambos intentos fallan → fallback coherente (hold, confidence 30)', async () => {
    fetch.mockResolvedValue({ json: async () => makeClaudeResponseText('texto inválido siempre') });

    const result = await runOrchestratorAgent(TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_MEDIUM);

    expect(result.final_action).toBe('hold');
    expect(result.confidence_score).toBe(30);
    expect(result.contradiction_detected).toBe(true);
  });

  it('SYSTEM_PROMPT contiene reglas de horizonte y veto fundamental', () => {
    expect(SYSTEM_PROMPT).toContain('0.60');   // peso técnico corto
    expect(SYSTEM_PROMPT).toContain('0.15');   // peso fundamental corto
    expect(SYSTEM_PROMPT).toContain('VETO FUNDAMENTAL');
    expect(SYSTEM_PROMPT).toContain('HOLD DE PRIMERA CLASE');
    expect(SYSTEM_PROMPT).toContain('CONFIRMACIÓN MÍNIMA');
    expect(SYSTEM_PROMPT).toContain('NO asesoría financiera');
  });

  it('A2: buildUserMessage NO incluye el array closes[] en el mensaje al LLM', () => {
    const msg = buildUserMessageForTest(TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_MEDIUM, 170);
    // El mensaje no debe contener el array closes literal del techResult
    // (el campo "closes" no debe aparecer como clave JSON en el contexto técnico)
    const techSection = msg.split('=== RESULTADO AGENTE TÉCNICO ===')[1]?.split('===')[0] ?? '';
    expect(techSection).not.toContain('"closes"');
  });

  it('A3: buildUserMessage incluye currentPrice en el contexto', () => {
    const msg = buildUserMessageForTest(TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_MEDIUM, 182.5);
    expect(msg).toContain('PRECIO ACTUAL');
    expect(msg).toContain('182.5');
  });

  it('A3: buildUserMessage con currentPrice null indica no disponible', () => {
    const msg = buildUserMessageForTest(TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_MEDIUM, null);
    expect(msg).toContain('PRECIO ACTUAL');
    expect(msg).toContain('null');
  });

  it('A2+A3: runOrchestratorAgent acepta currentPrice como 6to parámetro', async () => {
    const mockResponse = makeCloudeResponse({
      final_action: 'buy', confidence_score: 75, horizon: 'medium',
      price_target: 190, stop_loss: 165, portfolio_weight: 7,
      contradiction_detected: false,
      agent_weights: { technical: 0.40, fundamental: 0.35, risk: 0.25 },
      justification_multicriteria: 'Buy con precio ancla 175.',
    });
    fetch.mockResolvedValue({ json: async () => mockResponse });

    const result = await runOrchestratorAgent(
      TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_MEDIUM, () => {}, 175,
    );
    expect(result.final_action).toBe('buy');
    expect(result.price_target).toBe(190);
  });

  it('agent_weights inyectados por código corresponden al horizonte del perfil', async () => {
    const mockResponse = makeCloudeResponse({
      final_action: 'hold', confidence_score: 50, horizon: 'long',
      price_target: null, stop_loss: null, portfolio_weight: 3,
      contradiction_detected: false, agent_weights: { technical: 0.99, fundamental: 0, risk: 0 },
      justification_multicriteria: 'Test.',
    });
    fetch.mockResolvedValue({ json: async () => mockResponse });

    const result = await runOrchestratorAgent(TECH_BUY, FUND_BUY, RISK_LOW, PROFILE_LONG);

    // Para horizonte 'long': técnico 0.15, fundamental 0.60, riesgo 0.25
    // Aunque el LLM devuelva 0.99/0/0, el código los sobreescribe
    expect(result.agent_weights.technical).toBeCloseTo(0.15, 5);
    expect(result.agent_weights.fundamental).toBeCloseTo(0.60, 5);
    expect(result.agent_weights.risk).toBeCloseTo(0.25, 5);
  });
});
