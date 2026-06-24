import { useEffect, useState } from 'react';
import { useAuth, UserButton } from '@clerk/clerk-react';

function fmtDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function AdminPage() {
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, users: [], total: 0 });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 403) throw new Error('No tenés permisos de administrador.');
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        if (active) {
          setState({ loading: false, error: null, users: data.users ?? [], total: data.total ?? 0 });
        }
      } catch (err) {
        if (active) setState({ loading: false, error: err.message, users: [], total: 0 });
      }
    })();
    return () => { active = false; };
  }, [getToken]);

  const goBack = () => { window.location.hash = ''; };

  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono flex flex-col">
      {/* HEADER */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-blue-300 font-bold tracking-wide text-sm hover:text-blue-200"
        >
          <img src="/stockwise_icon_only.png" alt="StockWise" className="h-8 w-8 object-contain" />
          StockWise <span className="text-gray-600 font-normal">/ admin</span>
        </button>
        <div className="flex items-center gap-4">
          <button onClick={goBack} className="text-xs text-gray-400 hover:text-white">
            ← Volver al asesor
          </button>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      {/* BODY */}
      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-lg font-bold text-blue-300">Usuarios registrados</h1>
          {!state.loading && !state.error && (
            <span className="text-xs text-gray-500">{state.total} en total</span>
          )}
        </div>

        {state.loading && (
          <p className="text-sm text-gray-500">Cargando usuarios…</p>
        )}

        {state.error && (
          <div className="border border-red-900 bg-red-950/40 text-red-300 text-sm rounded-lg p-4">
            {state.error}
          </div>
        )}

        {!state.loading && !state.error && (
          <div className="overflow-x-auto border border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-2 font-medium">Usuario</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Rol</th>
                  <th className="px-4 py-2 font-medium">Registro</th>
                  <th className="px-4 py-2 font-medium">Último ingreso</th>
                </tr>
              </thead>
              <tbody>
                {state.users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-900 hover:bg-gray-900/40">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {u.imageUrl && (
                          <img src={u.imageUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                        )}
                        <span>{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-gray-300">{u.email ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={u.role === 'admin' ? 'text-blue-300' : 'text-gray-500'}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-400">{fmtDate(u.createdAt)}</td>
                    <td className="px-4 py-2 text-gray-400">{fmtDate(u.lastSignInAt)}</td>
                  </tr>
                ))}
                {state.users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-600">
                      No hay usuarios todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
