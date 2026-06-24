import { useState, useEffect } from 'react';
import { ClerkProvider, SignedIn, SignedOut } from '@clerk/clerk-react';
import InvestmentAdvisor from './InvestmentAdvisor.jsx';
import SignInScreen from './auth/SignInScreen.jsx';
import AdminPage from './admin/AdminPage.jsx';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

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
  if (!PUBLISHABLE_KEY) return <MissingKeyScreen />;

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <SignedIn>
        <Router />
      </SignedIn>
      <SignedOut>
        <SignInScreen />
      </SignedOut>
    </ClerkProvider>
  );
}
