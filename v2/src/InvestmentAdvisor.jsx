import { useState, useCallback, useEffect, useRef } from 'react';
import { useUser, UserButton, useAuth } from '@clerk/clerk-react';
import { kpi } from './lib/analytics.js';
import { runTechnicalAgent }    from './agents/technical.js';
import { runFundamentalAgent }  from './agents/fundamental.js';
import { runRiskAgent }         from './agents/risk.js';
import { runOrchestratorAgent } from './agents/orchestrator.js';
import { Component as StockMarketTrackerChart } from './components/ui/stock-market-tracker-chart.tsx';

// ── Fetchers ──────────────────────────────────────────────────────────────────

// Header de autenticación con el token de sesión de Clerk (si está disponible).
function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchYahoo(ticker, token) {
  try {
    const res = await fetch(`/api/yahoo?ticker=${encodeURIComponent(ticker)}`, {
      headers: authHeaders(token),
    });
    if (!res.ok) throw new Error(`Yahoo ${res.status}`);
    return await res.json();
  } catch (err) {
    return { _error: err.message };
  }
}

async function fetchAlpha(ticker, token) {
  try {
    const key = (typeof window !== 'undefined') && window.ENV?.ALPHA_VANTAGE_API_KEY;
    const url = key
      ? `/api/alpha?ticker=${encodeURIComponent(ticker)}&apikey=${key}`
      : `/api/alpha?ticker=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`Alpha ${res.status}`);
    return await res.json();
  } catch (err) {
    return { _error: err.message };
  }
}

// ── Constantes de UI ──────────────────────────────────────────────────────────

const STATE_LABEL = {
  idle:      'En espera',
  fetching:  'Obteniendo datos...',
  analyzing: 'Analizando...',
  ready:     'Listo',
  error:     'Error',
};

const STATE_COLOR = {
  idle:      'text-gray-500 border-gray-700',
  fetching:  'text-blue-400  border-blue-700',
  analyzing: 'text-yellow-400 border-yellow-700',
  ready:     'text-green-400 border-green-700',
  error:     'text-red-400   border-red-700',
};

const ACTION_BG = {
  buy:  'bg-green-500/15 text-green-300 border-green-500/40',
  sell: 'bg-red-500/15   text-red-300   border-red-500/40',
  hold: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40',
};

const SIGNAL_DOT = {
  buy:  'bg-green-400',
  sell: 'bg-red-400',
  hold: 'bg-yellow-400',
};

// ── ConfidenceRing SVG ────────────────────────────────────────────────────────

function ConfidenceRing({ score = 0, size = 96 }) {
  const r   = 38;
  const cx  = size / 2;
  const cy  = size / 2;
  const circ = 2 * Math.PI * r;
  const fill  = (score / 100) * circ;

  const color = score >= 70 ? '#4ade80'   // green-400
              : score >= 40 ? '#facc15'   // yellow-400
              :               '#f87171';  // red-400

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth="8" />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={color} strokeWidth="8"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text
        x={cx} y={cy + 1}
        textAnchor="middle" dominantBaseline="middle"
        fill={color}
        fontSize="18" fontWeight="700" fontFamily="monospace"
        style={{ transform: `rotate(90deg)`, transformOrigin: `${cx}px ${cy}px` }}
      >
        {score}%
      </text>
    </svg>
  );
}

// ── MobileFallback ────────────────────────────────────────────────────────────

function MobileFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono flex items-center justify-center p-8">
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-4">🖥</div>
        <h1 className="text-lg font-bold text-blue-300 mb-3">Pantalla demasiado pequeña</h1>
        <p className="text-sm text-gray-400 leading-relaxed">
          Esta aplicación requiere un ancho mínimo de escritorio de 900 px.
          Por favor, abrila desde una computadora o ampliá la ventana del navegador.
        </p>
      </div>
    </div>
  );
}

// ── Controles de sesión del header (botón usuario + acceso admin) ──────────────

function HeaderAuthControls() {
  const { user } = useUser();
  const isAdmin = user?.publicMetadata?.role === 'admin';

  return (
    <div className="flex items-center gap-4">
      <span className="text-xs text-gray-600">Información, no asesoría financiera</span>
      {isAdmin && (
        <button
          onClick={() => { window.location.hash = '#/admin'; }}
          className="text-xs text-blue-300 hover:text-blue-200 border border-gray-800 rounded px-2 py-1"
        >
          Admin
        </button>
      )}
      <UserButton afterSignOutUrl="/" />
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function InvestmentAdvisor() {
  // ── Todos los hooks van ANTES de cualquier return condicional (Rules of Hooks) ──

  const { getToken } = useAuth();

  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 900 : false,
  );
  const [ticker,    setTicker]    = useState('AAPL');
  const [loading,   setLoading]   = useState(false);
  const [yahooData, setYahooData] = useState(null);
  const [openAgent, setOpenAgent] = useState(null);

  const [profile, setProfile] = useState({
    capital:      100000,
    risk_profile: 'moderate',
    horizon:      'medium',
  });

  const [agentStates, setAgentStates] = useState({
    technical: 'idle', fundamental: 'idle', risk: 'idle', orchestrator: 'idle',
  });

  const [statusMessages, setStatusMessages] = useState({
    technical: '', fundamental: '', risk: '', orchestrator: '',
  });

  const [results, setResults] = useState({
    technical: null, fundamental: null, risk: null, orchestrator: null,
  });

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Abandono: el usuario entró y se va sin ejecutar ningún análisis.
  const hasAnalyzedRef = useRef(false);
  useEffect(() => {
    const onLeave = () => {
      if (!hasAnalyzedRef.current) kpi.abandono();
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, []);

  const setAgentState  = (a, s) => setAgentStates(p  => ({ ...p, [a]: s }));
  const setAgentStatus = (a, m) => setStatusMessages(p => ({ ...p, [a]: m }));
  const setAgentResult = (a, r) => setResults(p       => ({ ...p, [a]: r }));

  // ── Pipeline ─────────────────────────────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    if (!ticker.trim()) return;
    const symbol = ticker.trim().toUpperCase();
    hasAnalyzedRef.current = true;
    kpi.analysisRun({
      ticker: symbol,
      risk_profile: profile.risk_profile,
      horizon: profile.horizon,
    });
    kpi.tickerConsultado({ ticker: symbol });
    setLoading(true);
    setYahooData(null);
    setAgentStates({ technical: 'fetching', fundamental: 'fetching', risk: 'idle', orchestrator: 'idle' });
    setStatusMessages({ technical: '', fundamental: '', risk: '', orchestrator: '' });
    setResults({ technical: null, fundamental: null, risk: null, orchestrator: null });

    // Token de sesión de Clerk para autenticar las llamadas a los endpoints.
    const token = await getToken().catch(() => null);

    const [yahooSettled, alphaSettled] = await Promise.allSettled([
      fetchYahoo(symbol, token),
      fetchAlpha(symbol, token),
    ]);

    const yahoo = yahooSettled.status === 'fulfilled' ? yahooSettled.value : { _error: 'fetch falló' };
    const alpha = alphaSettled.status === 'fulfilled' ? alphaSettled.value : { _error: 'fetch falló' };

    if (!yahoo._error) setYahooData(yahoo);

    const currentPrice = yahoo?.closes?.at(-1) ?? null;

    // Técnico
    let techResult;
    if (yahoo._error) {
      setAgentState('technical', 'error');
      setAgentStatus('technical', yahoo._error);
      kpi.apiError({ source: 'yahoo', message: yahoo._error });
      techResult = { _error: yahoo._error };
    } else {
      setAgentState('technical', 'analyzing');
      try {
        techResult = await runTechnicalAgent(yahoo, m => setAgentStatus('technical', m));
        setAgentState('technical', 'ready');
      } catch (err) {
        setAgentState('technical', 'error');
        setAgentStatus('technical', err.message);
        kpi.apiError({ source: 'technical', message: err.message });
        techResult = { _error: err.message };
      }
    }
    setAgentResult('technical', techResult);

    // Fundamental
    let fundResult;
    if (alpha._error) {
      setAgentState('fundamental', 'error');
      setAgentStatus('fundamental', alpha._error);
      kpi.apiError({ source: 'alpha', message: alpha._error });
      fundResult = { _error: alpha._error };
    } else {
      setAgentState('fundamental', 'analyzing');
      try {
        fundResult = await runFundamentalAgent(alpha, m => setAgentStatus('fundamental', m));
        setAgentState('fundamental', 'ready');
      } catch (err) {
        setAgentState('fundamental', 'error');
        setAgentStatus('fundamental', err.message);
        kpi.apiError({ source: 'fundamental', message: err.message });
        fundResult = { _error: err.message };
      }
    }
    setAgentResult('fundamental', fundResult);

    // Riesgo
    setAgentState('risk', 'analyzing');
    let riskResult;
    try {
      riskResult = runRiskAgent(
        techResult?._error ? {} : techResult,
        fundResult?._error ? {} : fundResult,
        profile,
        m => setAgentStatus('risk', m),
      );
      setAgentState('risk', 'ready');
    } catch (err) {
      setAgentState('risk', 'error');
      setAgentStatus('risk', err.message);
      kpi.apiError({ source: 'risk', message: err.message });
      riskResult = { _error: err.message, risk_level: 'medium', max_weight_pct: 5, score: 0, beta: 1 };
    }
    setAgentResult('risk', riskResult);

    // Orquestador
    setAgentState('orchestrator', 'analyzing');
    let orchResult;
    try {
      orchResult = await runOrchestratorAgent(
        techResult?._error  ? null : techResult,
        fundResult?._error  ? null : fundResult,
        riskResult?._error  ? null : riskResult,
        profile,
        m => setAgentStatus('orchestrator', m),
        currentPrice,
        token,
      );
      setAgentState('orchestrator', 'ready');
    } catch (err) {
      setAgentState('orchestrator', 'error');
      setAgentStatus('orchestrator', err.message);
      kpi.apiError({ source: 'orchestrator', message: err.message });
      orchResult = {
        final_action: 'hold', confidence_score: 30, horizon: profile.horizon,
        price_target: null, stop_loss: null, portfolio_weight: 0,
        contradiction_detected: true,
        agent_weights: { technical: 0.40, fundamental: 0.35, risk: 0.25 },
        resumen_usuario:
          'Tuvimos un problema técnico y no pudimos completar el análisis, así que por ahora ' +
          'lo más prudente es esperar. Recordá que esto es información para ayudarte a decidir, ' +
          'no una asesoría financiera.',
        justification_multicriteria: 'Error en el orquestador. Resultado de seguridad: hold.',
      };
    }
    setAgentResult('orchestrator', orchResult);

    setLoading(false);
  }, [ticker, profile, getToken]);

  // Return condicional después de todos los hooks (Rules of Hooks)
  if (isMobile) return <MobileFallback />;

  const tech  = results.technical;
  const fund  = results.fundamental;
  const risk  = results.risk;
  const orch  = results.orchestrator;
  const done  = orch != null;

  const hasChartData = (yahooData?.closes?.length ?? 0) > 1;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono flex flex-col">

      {/* HEADER */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-blue-300 font-bold tracking-wide text-sm">
          <img src="/stockwise_icon_only.png" alt="StockWise" className="h-8 w-8 object-contain" />
          StockWise
        </span>
        <HeaderAuthControls />
      </header>

      {/* BODY */}
      <div className="flex flex-1 overflow-hidden">

        {/* SIDEBAR */}
        <aside className="w-72 border-r border-gray-800 p-5 flex flex-col gap-5 overflow-y-auto">

          {/* Ticker */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Ticker</label>
            <div className="flex gap-2">
              <input
                type="text" placeholder="AAPL"
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && !loading && runAnalysis()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm uppercase focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={runAnalysis}
                disabled={loading || !ticker.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded px-3 py-2 text-sm font-bold transition-colors"
              >
                {loading ? '…' : '▶'}
              </button>
            </div>
          </div>

          {/* Capital */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Capital (USD)</label>
            <input
              type="number" min="1000"
              value={profile.capital}
              onChange={e => setProfile(p => ({ ...p, capital: Number(e.target.value) }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Perfil de riesgo */}
          <div>
            <div className="text-xs text-gray-500 mb-2">Perfil de riesgo</div>
            <div className="flex flex-col gap-2">
              {[
                ['conservative', 'Conservador'],
                ['moderate',     'Moderado'],
                ['aggressive',   'Agresivo'],
              ].map(([v, lbl]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio" name="risk_profile" value={v}
                    checked={profile.risk_profile === v}
                    onChange={() => {
                      setProfile(p => ({ ...p, risk_profile: v }));
                      kpi.profileSelected({ risk_profile: v, horizon: profile.horizon });
                    }}
                    className="accent-blue-500"
                  />
                  {lbl}
                </label>
              ))}
            </div>
          </div>

          {/* Horizonte */}
          <div>
            <div className="text-xs text-gray-500 mb-2">Horizonte</div>
            <div className="flex flex-col gap-2">
              {[
                ['short',  'Corto plazo'],
                ['medium', 'Medio plazo'],
                ['long',   'Largo plazo'],
              ].map(([v, lbl]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio" name="horizon" value={v}
                    checked={profile.horizon === v}
                    onChange={() => {
                      setProfile(p => ({ ...p, horizon: v }));
                      kpi.profileSelected({ risk_profile: profile.risk_profile, horizon: v });
                    }}
                    className="accent-blue-500"
                  />
                  {lbl}
                </label>
              ))}
            </div>
          </div>

          {/* Estado del pipeline */}
          <div className="border-t border-gray-800 pt-4">
            <div className="text-xs text-gray-500 mb-3 uppercase tracking-widest">Pipeline</div>
            <div className="flex flex-col gap-2">
              {[
                ['technical',    'Técnico'],
                ['fundamental',  'Fundamental'],
                ['risk',         'Riesgo'],
                ['orchestrator', 'Orquestador'],
              ].map(([key, lbl]) => {
                const state = agentStates[key];
                const msg   = statusMessages[key];
                return (
                  <div key={key} className={`border rounded px-2 py-1.5 ${STATE_COLOR[state]}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">{lbl}</span>
                      <span className="text-xs">{STATE_LABEL[state]}</span>
                    </div>
                    {msg && <div className="text-xs text-gray-600 truncate mt-0.5">{msg}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {done && yahooData && (
            <div className="border-t border-gray-800 pt-4 text-xs text-gray-600">
              <div>{yahooData.ticker} · {yahooData.currency}</div>
              <div>Precio: <span className="text-white">${yahooData.currentPrice?.toFixed(2)}</span></div>
              <div>{yahooData.closes?.length ?? 0} sesiones cargadas</div>
            </div>
          )}
        </aside>

        {/* MAIN */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Placeholder inicial */}
          {!done && !loading && (
            <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
              Ingresá un ticker y presioná ▶ para analizar
            </div>
          )}

          {/* Gráfico de precio con selector de período */}
          {hasChartData && (
            <div className="dark">
              <StockMarketTrackerChart
                ticker={yahooData?.ticker}
                closes={yahooData?.closes ?? []}
                dates={yahooData?.dates ?? []}
                currentPrice={yahooData?.currentPrice}
                className="max-w-none rounded-lg"
              />
            </div>
          )}

          {/* Panel de métricas: 3 columnas */}
          {done && (
            <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
              <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-4">
                Métricas por agente
              </h2>
              <div className="grid grid-cols-3 gap-4">

                {/* Técnico */}
                <AgentMetricsCard
                  title="Técnico"
                  signal={tech?.signal}
                  score={tech?.score}
                  confidence={tech?.confidence}
                  rows={
                    tech && !tech._error
                      ? [
                          ['RSI',      tech.indicators?.rsi?.toFixed(1) ?? 'N/D'],
                          ['MACD',     tech.indicators?.macd?.line?.toFixed(2) ?? 'N/D'],
                          ['SMA 50',   tech.indicators?.sma50?.toFixed(2)  ?? 'N/D'],
                          ['SMA 200',  tech.indicators?.sma200?.toFixed(2) ?? 'N/D'],
                          ['Régimen',  tech.regime ?? 'N/D'],
                          ['Vol. anual', tech.indicators?.volatility_annual
                            ? `${(tech.indicators.volatility_annual * 100).toFixed(1)}%`
                            : 'N/D'],
                        ]
                      : null
                  }
                  error={tech?._error}
                />

                {/* Fundamental */}
                <AgentMetricsCard
                  title="Fundamental"
                  signal={fund?.signal}
                  score={fund?.score}
                  confidence={fund?.confidence}
                  rows={
                    fund && !fund._error
                      ? [
                          ['Valuación',   fund.valuation ?? 'N/D'],
                          ['Quality',     fund.quality_score != null ? `${fund.quality_score}/100` : 'N/D'],
                          ['P/E vs sect', fund.metrics_vs_sector?.pe?.verdict ?? 'N/D'],
                          ['ROE',         fund.metrics_vs_sector?.roe?.verdict ?? 'N/D'],
                          ['PEG',         fund.metrics_vs_sector?.peg?.verdict ?? 'N/D'],
                          ['Beta',        fund.beta?.toFixed(2) ?? 'N/D'],
                        ]
                      : null
                  }
                  error={fund?._error}
                />

                {/* Riesgo */}
                <AgentMetricsCard
                  title="Riesgo"
                  signal={risk?.risk_level === 'low' ? 'buy' : risk?.risk_level === 'high' ? 'sell' : 'hold'}
                  score={risk?.score}
                  confidence={null}
                  rows={
                    risk && !risk._error
                      ? [
                          ['Nivel',      risk.risk_level ?? 'N/D'],
                          ['Vol. anual', risk.volatility_annual != null
                            ? `${(risk.volatility_annual * 100).toFixed(1)}%`
                            : 'N/D'],
                          ['Beta',       risk.beta?.toFixed(2) ?? 'N/D'],
                          ['VaR 95%',    risk.var_95_usd != null ? `$${risk.var_95_usd}` : 'N/D'],
                          ['ES 95%',     risk.es_95_pct != null
                            ? `${(risk.es_95_pct * 100).toFixed(2)}%`
                            : 'N/D'],
                          ['Max peso',   risk.max_weight_pct != null ? `${risk.max_weight_pct}%` : 'N/D'],
                        ]
                      : null
                  }
                  error={risk?._error}
                />
              </div>
            </section>
          )}

          {/* Panel de recomendación */}
          {done && orch && (
            <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
              <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-4">
                Recomendación final
              </h2>

              {/* Fila principal: acción + anillo */}
              <div className="flex items-center gap-6 mb-5">
                <span className={`px-6 py-2 rounded border text-2xl font-bold uppercase tracking-widest ${ACTION_BG[orch.final_action] ?? ACTION_BG.hold}`}>
                  {orch.final_action}
                </span>
                <ConfidenceRing score={orch.confidence_score} size={96} />
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Confianza</span>
                  <span className="text-lg font-bold">{orch.confidence_score}%</span>
                </div>
                {orch.contradiction_detected && (
                  <span className="text-xs text-orange-400 border border-orange-400/40 rounded px-2 py-1 self-start">
                    Contradicción
                  </span>
                )}
              </div>

              {/* Targets */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-800 rounded p-3">
                  <div className="text-xs text-gray-500 mb-1">Precio objetivo</div>
                  <div className="text-sm font-bold text-green-300">
                    {orch.price_target != null ? `$${orch.price_target.toFixed(2)}` : '—'}
                  </div>
                </div>
                <div className="bg-gray-800 rounded p-3">
                  <div className="text-xs text-gray-500 mb-1">Stop loss</div>
                  <div className="text-sm font-bold text-red-400">
                    {orch.stop_loss != null ? `$${orch.stop_loss.toFixed(2)}` : '—'}
                  </div>
                </div>
                <div className="bg-gray-800 rounded p-3">
                  <div className="text-xs text-gray-500 mb-1">Peso cartera</div>
                  <div className="text-sm font-bold">
                    {orch.portfolio_weight?.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Pesos por horizonte */}
              {orch.agent_weights && (
                <div className="flex gap-4 mb-4">
                  {[
                    ['Técnico',      orch.agent_weights.technical],
                    ['Fundamental',  orch.agent_weights.fundamental],
                    ['Riesgo',       orch.agent_weights.risk],
                  ].map(([lbl, w]) => (
                    <div key={lbl} className="flex-1">
                      <div className="text-xs text-gray-500 mb-1">{lbl} {Math.round(w * 100)}%</div>
                      <div className="h-1.5 bg-gray-700 rounded">
                        <div
                          className="h-1.5 bg-blue-500 rounded transition-all"
                          style={{ width: `${w * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Resumen para el usuario (lenguaje accesible) */}
              <div className="bg-gray-800 rounded p-4 text-sm text-gray-200 leading-relaxed">
                {orch.resumen_usuario ?? orch.justification_multicriteria}
              </div>

              {/* Detalle técnico (opcional, colapsado) */}
              {orch.justification_multicriteria && (
                <details className="mt-3">
                  <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer">
                    Ver explicación técnica detallada
                  </summary>
                  <div className="bg-gray-800/60 rounded p-4 mt-2 text-xs text-gray-400 leading-relaxed">
                    {orch.justification_multicriteria}
                  </div>
                </details>
              )}
            </section>
          )}

          {/* Datos crudos por agente */}
          {done && (
            <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
              <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-3">
                Datos crudos
              </h2>
              {[
                ['technical',    'Técnico'],
                ['fundamental',  'Fundamental'],
                ['risk',         'Riesgo'],
                ['orchestrator', 'Orquestador'],
              ].map(([key, lbl]) => (
                <div key={key} className="mb-1">
                  <button
                    className="w-full text-left text-xs text-gray-600 hover:text-gray-300 flex justify-between py-1 border-b border-gray-800"
                    onClick={() => setOpenAgent(o => o === key ? null : key)}
                  >
                    <span>{lbl}</span>
                    <span>{openAgent === key ? '▲' : '▼'}</span>
                  </button>
                  {openAgent === key && (
                    <pre className="bg-gray-800 rounded p-3 text-xs text-gray-400 overflow-x-auto mt-1 max-h-56 overflow-y-auto">
                      {JSON.stringify(results[key], null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </section>
          )}

        </main>
      </div>

      {/* FOOTER */}
      <footer className="border-t border-gray-800 px-6 py-2 text-xs text-gray-600 text-center">
        Este sistema produce información para la toma de decisiones, no asesoría financiera.
        No ejecuta órdenes. Consulte a un profesional antes de invertir.
      </footer>
    </div>
  );
}

// ── Sub-componente: tarjeta de métricas por agente ────────────────────────────

function AgentMetricsCard({ title, signal, score, confidence, rows, error }) {
  const sigColor = signal === 'buy' ? 'text-green-400'
                 : signal === 'sell' ? 'text-red-400'
                 : 'text-yellow-400';

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 font-bold uppercase">{title}</span>
        {signal && (
          <span className={`text-xs font-bold uppercase ${sigColor}`}>
            {signal}
          </span>
        )}
      </div>

      {error ? (
        <div className="text-xs text-gray-600">No disponible</div>
      ) : rows ? (
        <div className="space-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="text-gray-500">{k}</span>
              <span className="text-gray-200 font-mono">{v}</span>
            </div>
          ))}
          {score != null && (
            <div className="flex justify-between text-xs border-t border-gray-700 pt-1.5 mt-2">
              <span className="text-gray-500">Score</span>
              <span className={`font-bold ${score > 0 ? 'text-green-400' : score < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                {score > 0 ? '+' : ''}{score?.toFixed(3)}
              </span>
            </div>
          )}
          {confidence != null && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Confianza</span>
              <span className="text-gray-200">{confidence}%</span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-gray-600">Sin datos</div>
      )}
    </div>
  );
}
