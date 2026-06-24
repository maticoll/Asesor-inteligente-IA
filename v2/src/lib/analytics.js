/**
 * analytics.js — Eventos de KPI sobre Vercel Analytics.
 *
 * Centraliza los nombres de evento y las props para no esparcir track() por la app.
 * track() solo acepta props planas (string | number | boolean | null).
 * Todo va envuelto en try/catch: si Analytics no está disponible, es no-op.
 */
import { track } from '@vercel/analytics';

function trackEvent(name, props) {
  try {
    track(name, props);
  } catch {
    /* no-op: nunca romper la app por analytics */
  }
}

export const kpi = {
  /** Registro de un usuario nuevo (1 vez por usuario). */
  signup: (props) => trackEvent('user_signup', props),

  /** Inicio de sesión (1 vez por sesión de pestaña). */
  login: (props) => trackEvent('login', props),

  /** Un análisis fue ejecutado. props: { ticker, risk_profile, horizon }. */
  analysisRun: (props) => trackEvent('analysis_run', props),

  /** El usuario entró y se fue sin ejecutar ningún análisis. */
  abandono: (props) => trackEvent('abandono', props),

  /** Falló una llamada de API/agente. props: { source, message }. */
  apiError: (props) => trackEvent('api_error', props),
};
