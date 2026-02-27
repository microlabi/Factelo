import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { InvoiceNewPage } from "@/pages/InvoiceNewPage";
import { FacturasPage } from "@/pages/FacturasPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { ClientesPage } from "@/pages/ClientesPage";
import { ProductosPage } from "@/pages/ProductosPage";
import { useUpdater } from "@/hooks/useUpdater";

export function App() {
  useUpdater();

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* ── Ruta de onboarding (fuera del layout principal) ────────── */}
          <Route path="/onboarding" element={<OnboardingPage />} />

          {/* ── Rutas protegidas dentro del layout ─────────────────────── */}
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="/facturas" element={<FacturasPage />} />
            <Route path="/facturas/nueva" element={<InvoiceNewPage />} />
            <Route path="/clientes" element={<ClientesPage />} />
            <Route path="/productos" element={<ProductosPage />} />
            <Route
              path="/gastos"
              element={<div className="text-sm text-muted-foreground">Módulo de gastos en siguiente fase.</div>}
            />
            <Route path="/empresa" element={<SettingsPage />} />
            <Route path="/configuracion" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
