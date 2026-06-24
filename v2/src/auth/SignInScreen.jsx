import { SignIn } from '@clerk/clerk-react';

// Pantalla de login con la identidad visual de StockWise (tema oscuro).
export default function SignInScreen() {
  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-3 text-blue-300 font-bold tracking-wide text-lg">
        <img src="/stockwise_icon_only.png" alt="StockWise" className="h-10 w-10 object-contain" />
        StockWise
      </div>
      <p className="text-sm text-gray-500 text-center max-w-sm">
        Iniciá sesión para acceder al asesor de inversiones multi-agente.
      </p>

      <SignIn
        appearance={{
          elements: {
            card: 'shadow-xl border border-gray-200',
            headerTitle: 'text-blue-700',
          },
        }}
      />

      <p className="text-xs text-gray-700 text-center max-w-sm">
        Información, no asesoría financiera. No ejecuta órdenes ni garantiza rendimientos.
      </p>
    </div>
  );
}
