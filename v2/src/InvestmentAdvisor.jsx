import { useState, useCallback } from 'react';
import { runTechnicalAgent }    from './agents/technical.js';
import { runFundamentalAgent }  from './agents/fundamental.js';
import { runRiskAgent }         from './agents/risk.js';
import { runOrchestratorAgent } from './agents/orchestrator.js';

// ── Fetchers de datos ─────────────────────────────────────────────────────────

async function fetchYahoo(ticker) {
  try {
    const res = await fetch(`/api/yahoo?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`Yahoo ${res.status}`);
    return await res.json();
  } catch (err) {
    return { _error: err.message };
  }
}

async function fetchAlpha(ticker) {
  try {
    const key = (typeof window !== 'undefined') && window.ENV?.ALPHA_VANTAGE_API_KEY;
    const url  = key
      ? `/api/alpha?ticker=${encodeURIComponent(ticker)}&apikey=${key}`
      : `/api/alpha?ticker=${encodeURIComponent(ticker)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha ${res.status}`);
    return await res.json();
  } catch (err) {
    return { _error: err.message };
  }
}

// ── Colores y etiquetas ───────────────────────────────────────────────────────

const STATE_LABEL = {
  idle:      'En espera',
  fetching:  'Obteniendo datos...',
  analyzing: 'Analizando...',
  ready:     'Listo',
  error:     'Error',
};

const STATE_COLOR = {
  idle:      'text-gray-500',
  fetching:  'text-blue-400',
  analyzing: 'text-yellow-400',
  ready:     'text-green-400',
  error:     'text-red-400',
};

const ACTION_STYLE = {
  buy:  'bg-green-500/20 text-green-300 border border-green-500/40',
  sell: 'bg-red-500/20 text-red-300 border border-red-500/40',
  hold: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function InvestmentAdvisor() {
  const [ticker,  setTicker]  = useState('AAPL');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({
    capital:      100000,
    risk_profile: 'moderate',
    horizon:      'medium',
  });

  const [agentStates, setAgentStates] = useState({
    technical:    'idle',
    fundamental:  'idle',
    risk:         'idle',
    orchestrator: 'idle',
  });

  const [statusMessages, setStatusMessages] = useState({
    technical:    '',
    fundamental:  '',
    risk:         '',
    orchestrator: '',
  });

  const [results, setResults] = useState({
    technical:    null,
    fundamental:  null,
    risk:         null,
    orchestrator: null,
  });

  const [openAgent, setOpenAgent] = useState(null);  // for raw-data collapse

  const setAgentState = (agent, state) =>
    setAgentStates(prev => ({ ...prev, [agent]: state }));

  const setAgentStatus = (agent, msg) =>
    setStatusMessages(prev => ({ ...prev, [agent]: msg }));

  const setAgentResult = (agent, result) =>
    setResults(prev => ({ ...prev, [agent]: result }));

  // ── Pipeline ─────────────────────────────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    if (!ticker.trim()) return;
    setLoading(true);

    // Reset
    setAgentStates({ technical: 'fetching', fundamental: 'fetching', risk: 'idle', orchestrator: 'idle' });
    setStatusMessages({ technical: '', fundamental: '', risk: '', orchestrator: '' });
    setResults({ technical: null, fundamental: null, risk: null, orchestrator: null });

    // ── Fase 1: fetch paralelo ────────────────────────────────────────────────
    const [yahooSettled, alphaSettled] = await Promise.allSettled([
      fetchYahoo(ticker.trim().toUpperCase()),
      fetchAlpha(ticker.trim().toUpperCase()),
    ]);

    const yahooData = yahooSettled.status === 'fulfilled' ? yahooSettled.value : { _error: 'fetch falló' };
    const alphaData = alphaSettled.status === 'fulfilled' ? alphaSettled.value : { _error: 'fetch falló' };

    // ── Agente técnico ────────────────────────────────────────────────────────
    let techResult;
    if (yahooData._error) {
      setAgentState('technical', 'error');
      setAgentStatus('technical', yahooData._error);
      techResult = { _error: yahooData._error };
    } else {
      setAgentState('technical', 'analyzing');
      try {
        techResult = await runTechnicalAgent(
          yahooData,
          (msg) => setAgentStatus('technical', msg),
        );
        setAgentState('technical', 'ready');
      } catch (err) {
        setAgentState('technical', 'error');
        setAgentStatus('technical', err.message);
        techResult = { _error: err.message };
      }
    }
    setAgentResult('technical', techResult);

    // ── Agente fundamental ────────────────────────────────────────────────────
    let fundResult;
    if (alphaData._error) {
      setAgentState('fundamental', 'error');
      setAgentStatus('fundamental', alphaData._error);
      fundResult = { _error: alphaData._error };
    } else {
      setAgentState('fundamental', 'analyzing');
      try {
        fundResult = await runFundamentalAgent(
          alphaData,
          (msg) => setAgentStatus('fundamental', msg),
        );
        setAgentState('fundamental', 'ready');
      } catch (err) {
        setAgentState('fundamental', 'error');
        setAgentStatus('fundamental', err.message);
        fundResult = { _error: err.message };
      }
    }
    setAgentResult('fundamental', fundResult);

    // ── Agente de riesgo (sincrónico pero puede fallar) ───────────────────────
    setAgentState('risk', 'analyzing');
    let riskResult;
    try {
      // Si técnico falló, pasamos objeto vacío para que risk use fallbacks
      const techForRisk = techResult?._error ? {} : techResult;
      const fundForRisk = fundResult?._error ? {} : fundResult;
      riskResult = runRiskAgent(
        techForRisk,
        fundForRisk,
        profile,
        (msg) => setAgentStatus('risk', msg),
      );
      setAgentState('risk', 'ready');
    } catch (err) {
      setAgentState('risk', 'error');
      setAgentStatus('risk', err.message);
      // Fallback mínimo para que el orquestador pueda continuar
      riskResult = {
        _error:         err.message,
        risk_level:     'medium',
        max_weight_pct: 5,
        score:          0,
        beta:           1,
        justification:  'Agente de riesgo no disponible.',
      };
    }
    setAgentResult('risk', riskResult);

    // ── Orquestador ───────────────────────────────────────────────────────────
    setAgentState('orchestrator', 'analyzing');
    let orchResult;
    try {
      const techForOrch = techResult?._error  ? null : techResult;
      const fundForOrch = fundResult?._error  ? null : fundResult;
      const riskForOrch = riskResult?._error  ? null : riskResult;
      orchResult = await runOrchestratorAgent(
        techForOrch,
        fundForOrch,
        riskForOrch,
        profile,
        (msg) => setAgentStatus('orchestrator', msg),
      );
      setAgentState('orchestrator', 'ready');
    } catch (err) {
      setAgentState('orchestrator', 'error');
      setAgentStatus('orchestrator', err.message);
      orchResult = {
        final_action:               'hold',
        confidence_score:           30,
        horizon:                    profile.horizon,
        price_target:               null,
        stop_loss:                  null,
        portfolio_weight:           0,
        contradiction_detected:     true,
        agent_weights:              { technical: 0.40, fundamental: 0.35, risk: 0.25 },
        justification_multicriteria: 'Error en el orquestador. Resultado de seguridad: hold.',
      };
    }
    setAgentResult('orchestrator', orchResult);

    setLoading(false);
  }, [ticker, profile]);

  const orch   = results.orchestrator;
  const anyResult = orch != null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono p-6 max-w-3xl mx-auto">

      {/* Título */}
      <h1 className="text-xl font-bold text-blue-300 mb-6 tracking-wide">
        Asesor de Inversiones — MVP v2
      </h1>

      {/* ── Perfil e input ── */}
      <section className="bg-gray-900 rounded-lg p-5 mb-5 border border-gray-800">
        <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-4">Perfil del inversor</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          {/* Capital */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Capital (USD)</span>
            <input
              type="number" min="1000"
              value={profile.capital}
              onChange={e => setProfile(p => ({ ...p, capital: Number(e.target.value) }))}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </label>

          {/* Ticker */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Ticker</span>
            <input
              type="text" placeholder="AAPL"
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && !loading && runAnalysis()}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm uppercase focus:outline-none focus:border-blue-500"
            />
          </label>
        </div>

        {/* Perfil de riesgo */}
        <div className="flex gap-4 mb-3">
          <span className="text-xs text-gray-500 w-24 self-center">Riesgo</span>
          {['conservative', 'moderate', 'aggressive'].map(v => (
            <label key={v} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio" name="risk_profile" value={v}
                checked={profile.risk_profile === v}
                onChange={() => setProfile(p => ({ ...p, risk_profile: v }))}
                className="accent-blue-500"
              />
              {{ conservative: 'Conservador', moderate: 'Moderado', aggressive: 'Agresivo' }[v]}
            </label>
          ))}
        </div>

        {/* Horizonte */}
        <div className="flex gap-4 mb-5">
          <span className="text-xs text-gray-500 w-24 self-center">Horizonte</span>
          {['short', 'medium', 'long'].map(v => (
            <label key={v} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio" name="horizon" value={v}
                checked={profile.horizon === v}
                onChange={() => setProfile(p => ({ ...p, horizon: v }))}
                className="accent-blue-500"
              />
              {{ short: 'Corto', medium: 'Medio', long: 'Largo' }[v]}
            </label>
          ))}
        </div>

        <button
          onClick={runAnalysis}
          disabled={loading || !ticker.trim()}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded px-4 py-2 text-sm font-bold transition-colors"
        >
          {loading ? 'Analizando...' : 'Analizar'}
        </button>
      </section>

      {/* ── Estados de los agentes ── */}
      <section className="bg-gray-900 rounded-lg p-5 mb-5 border border-gray-800">
        <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-4">Estado del pipeline</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['technical',    'Técnico'],
            ['fundamental',  'Fundamental'],
            ['risk',         'Riesgo'],
            ['orchestrator', 'Orquestador'],
          ].map(([key, label]) => {
            const state = agentStates[key];
            const msg   = statusMessages[key];
            return (
              <div key={key} className="flex flex-col">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{label}</span>
                  <span className={`text-xs ${STATE_COLOR[state]}`}>
                    {STATE_LABEL[state]}
                  </span>
                </div>
                {msg && (
                  <span className="text-xs text-gray-600 truncate mt-0.5">{msg}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Resultado final ── */}
      {anyResult && (
        <section className="bg-gray-900 rounded-lg p-5 mb-5 border border-gray-800">
          <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-4">Recomendación</h2>

          <div className="flex items-center gap-4 mb-4">
            <span className={`px-4 py-1 rounded text-lg font-bold uppercase tracking-widest ${ACTION_STYLE[orch.final_action] ?? ACTION_STYLE.hold}`}>
              {orch.final_action}
            </span>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Confianza</span>
              <span className="text-sm font-bold">{orch.confidence_score}%</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Peso cartera</span>
              <span className="text-sm font-bold">{orch.portfolio_weight?.toFixed(1)}%</span>
            </div>
            {orch.contradiction_detected && (
              <span className="text-xs text-orange-400 border border-orange-400/40 rounded px-2 py-1">
                Contradicción detectada
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-800 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">Precio objetivo</div>
              <div className="text-sm font-bold">
                {orch.price_target != null ? `$${orch.price_target.toFixed(2)}` : 'N/D'}
              </div>
            </div>
            <div className="bg-gray-800 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">Stop loss</div>
              <div className="text-sm font-bold text-red-400">
                {orch.stop_loss != null ? `$${orch.stop_loss.toFixed(2)}` : 'N/D'}
              </div>
            </div>
          </div>

          {orch.agent_weights && (
            <div className="flex gap-3 mb-4 text-xs text-gray-500">
              <span>Pesos aplicados:</span>
              <span>Técnico {(orch.agent_weights.technical * 100).toFixed(0)}%</span>
              <span>Fundamental {(orch.agent_weights.fundamental * 100).toFixed(0)}%</span>
              <span>Riesgo {(orch.agent_weights.risk * 100).toFixed(0)}%</span>
            </div>
          )}

          <div className="bg-gray-800 rounded p-3 text-sm text-gray-300 leading-relaxed">
            {orch.justification_multicriteria}
          </div>
        </section>
      )}

      {/* ── Datos crudos por agente ── */}
      {anyResult && (
        <section className="bg-gray-900 rounded-lg p-5 mb-5 border border-gray-800">
          <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-4">Datos por agente</h2>
          {[
            ['technical',    'Técnico'],
            ['fundamental',  'Fundamental'],
            ['risk',         'Riesgo'],
            ['orchestrator', 'Orquestador'],
          ].map(([key, label]) => (
            <div key={key} className="mb-2">
              <button
                className="w-full text-left text-xs text-gray-500 hover:text-gray-300 flex justify-between py-1"
                onClick={() => setOpenAgent(o => o === key ? null : key)}
              >
                <span>{label}</span>
                <span>{openAgent === key ? '▲' : '▼'}</span>
              </button>
              {openAgent === key && (
                <pre className="bg-gray-800 rounded p-3 text-xs text-gray-400 overflow-x-auto mt-1 max-h-60 overflow-y-auto">
                  {JSON.stringify(results[key], null, 2)}
                </pre>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ── Disclaimer ── */}
      <p className="text-xs text-gray-600 text-center border border-gray-800 rounded p-3">
        Este sistema produce información para la toma de decisiones, no asesoría financiera.
        No ejecuta órdenes. Consulte a un profesional antes de invertir.
      </p>

    </div>
  );
}
