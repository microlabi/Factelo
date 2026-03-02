import { useState } from "react";
import { Outlet, useLocation, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { cn } from "@/lib/utils";
import { useOnboarding } from "@/hooks/useOnboarding";

// ─── Mapa de títulos de ruta ──────────────────────────────────────────────────

const ROUTE_TITLES: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Dashboard",
    description: "Visión general de tu actividad económica",
  },
  "/facturas": {
    title: "Facturas",
    description: "Gestiona y emite facturas con firma VeriFactu",
  },
  "/clientes": {
    title: "Clientes",
    description: "Directorio de clientes y su actividad",
  },
  "/productos": {
    title: "Productos y servicios",
    description: "Catálogo de productos y tarifas",
  },
  "/gastos": {
    title: "Gastos",
    description: "Registro de gastos e IVA soportado",
  },
  "/empresa": {
    title: "Mi empresa",
    description: "Datos fiscales y certificado digital",
  },
  "/configuracion": {
    title: "Configuración",
    description: "Preferencias de la aplicación",
  },
};

// ─── Layout ──────────────────────────────────────────────────────────────────

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Inicializar el modo oscuro desde localStorage
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem("factelo-dark-mode");
    const isDark = stored === "true";
    // Aplicar al DOM de inmediato para evitar flash
    document.documentElement.classList.toggle("dark", isDark);
    return isDark;
  });
  const { pathname } = useLocation();
  const onboarding = useOnboarding();

  // ── Guard de onboarding ────────────────────────────────────────────────────
  if (onboarding.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm">Iniciando Factelo…</p>
        </div>
      </div>
    );
  }

  if (onboarding.status === "required") {
    return <Navigate to="/onboarding" replace />;
  }

  const routeMatch =
    Object.entries(ROUTE_TITLES).find(([pattern]) => {
      if (pattern === "/") return pathname === "/";
      return pathname.startsWith(pattern);
    })?.[1] ?? { title: "Factelo", description: "" };

  const handleToggleDark = () => {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("factelo-dark-mode", String(next));
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar
            title={routeMatch.title}
            description={routeMatch.description}
            darkMode={darkMode}
            onToggleDark={handleToggleDark}
          />

          <main
            className={cn(
              "flex-1 overflow-y-auto",
              "transition-all duration-300"
            )}
          >
            <div className="mx-auto max-w-screen-2xl p-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
