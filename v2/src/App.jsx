import { useState, useEffect } from 'react';
import { ClerkProvider, SignedIn, SignedOut, useUser } from '@clerk/clerk-react';
import { Analytics } from '@vercel/analytics/react';
import InvestmentAdvisor from './InvestmentAdvisor.jsx';
import SignInScreen from './auth/SignInScreen.jsx';
import AdminPage from './admin/AdminPage.jsx';
import { kpi } from './lib/analytics.js';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Ventana para considerar una cuenta "recién creada" (registro vs. login).
const SIGNUP_WINDOW_MS = 2 * 60 * 1000;

// ── Tracker de KPIs de autenticación (registro / login) ────────────────────────
// Se monta dentro de <SignedIn>, así corre cuando ya hay sesión activa.
function AuthKpiTracker() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    // Registro: cuenta nueva (createdAt reciente), una sola vez por usuario.
    const signupKey = `kpi_signup_${user.id}`;
    const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;
    const isNew = createdAt > 0 && Date.now() - createdAt < SIGNUP_WINDOW_MS;

    let countedAsSignup = false;
    if (isNew && !localStorage.getItem(signupKey)) {
      kpi.signup({ method: user.primaryEmailAddress ? 'email' : 'other' });
      localStorage.setItem(signupKey, '1');
      countedAsSignup = true;
    }

    // Login: una vez por sesión de pestaña. El primer ingreso de un usuario nuevo
    // se contabiliza como registro, no como login (evita doble conteo del funnel).
    const loginKey = 'kpi_login_fired';
    if (sessionStorage.getItem(loginKey) !== user.id) {
      if (!countedAsSignup) kpi.login();
      sessionStorage.setItem(loginKey, user.id);
    }
  }, [isLoaded, isSignedIn, user]);

  return null;
}

// ── Router minimalista basado en hash (sin dependencias) ───────────────────────
function Router() {
  const [hash, setHash] = useState(
    typeof window !== 'undefined' ? window.location.hash : '',
  );

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (hash === '#/admin') return <AdminPage />;
  return <InvestmentAdvisor />;
}

// ── Pantalla de configuración faltante (evita pantalla en blanco) ──────────────
function MissingKeyScreen() {
  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4">🔑</div>
        <h1 className="text-lg font-bold text-blue-300 mb-3">Falta configurar Clerk</h1>
        <p className="text-sm text-gray-400 leading-relaxed">
          No se encontró <code className="text-blue-300">VITE_CLERK_PUBLISHABLE_KEY</code>.
          Cargala en <code className="text-blue-300">v2/.env.local</code> (dev) y en las
          variables de entorno de Vercel (producción), luego volvé a desplegar.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  if (!PUBLISHABLE_KEY) {
    return (
      <>
        <MissingKeyScreen />
        <Analytics />
      </>
    );
  }

  return (
    <>
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        afterSignOutUrl="/"
        appearance={{
          variables: {
            colorPrimary: '#2563eb',
            borderRadius: '0.5rem',
          },
        }}
      >
        <SignedIn>
          <AuthKpiTracker />
          <Router />
        </SignedIn>
        <SignedOut>
          <SignInScreen />
        </SignedOut>
      </ClerkProvider>
      <Analytics />
    </>
  );
}
