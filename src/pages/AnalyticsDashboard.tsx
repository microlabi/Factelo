import { useState, useCallback } from "react";
import {
  BarChart3,
  Euro,
  FileText,
  Layers,
  RefreshCw,
  FilterX,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useTauriQuery } from "@/hooks/useTauriCommand";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import { formatCurrency } from "@/lib/utils";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AdvancedAnalyticsResult {
  total_base_imponible: number;
  total_facturado: number;
  num_facturas: number;
  num_lineas: number;
}

interface AnalyticsParams {
  empresa_id: number;
  fecha_inicio?: string;
  fecha_fin?: string;
  tipo_entidad?: string;
  texto_producto?: string;
}

// ─── Rangos de fechas predefinidos ───────────────────────────────────────────

const PERIODOS: { label: string; value: string; inicio: string; fin: string }[] = [
  { label: "Todo el tiempo", value: "all",    inicio: "",           fin: ""           },
  { label: "Q1 2026",        value: "q1-2026", inicio: "2026-01-01", fin: "2026-03-31" },
  { label: "Q2 2026",        value: "q2-2026", inicio: "2026-04-01", fin: "2026-06-30" },
  { label: "Q3 2026",        value: "q3-2026", inicio: "2026-07-01", fin: "2026-09-30" },
  { label: "Q4 2026",        value: "q4-2026", inicio: "2026-10-01", fin: "2026-12-31" },
  { label: "Año 2026",       value: "y-2026",  inicio: "2026-01-01", fin: "2026-12-31" },
  { label: "Año 2025",       value: "y-2025",  inicio: "2025-01-01", fin: "2025-12-31" },
];

const TIPOS_ENTIDAD = [
  { label: "Todos los clientes", value: "Todos"          },
  { label: "Empresa",            value: "Empresa"        },
  { label: "Autónomo",           value: "Autónomo"       },
  { label: "Entidad Pública",    value: "Entidad Pública"},
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  accent?: "primary" | "emerald" | "violet" | "amber";
}

function KpiCard({ title, value, description, icon: Icon, accent = "primary" }: KpiCardProps) {
  const accentColors: Record<string, string> = {
    primary: "text-primary bg-primary/10",
    emerald: "text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30",
    violet:  "text-violet-600 bg-violet-100 dark:text-violet-400 dark:bg-violet-900/30",
    amber:   "text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30",
  };

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <span className={`flex size-9 items-center justify-center rounded-lg ${accentColors[accent]}`}>
            <Icon className="size-5" />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

// ─── Dashboard principal ──────────────────────────────────────────────────────

export function AnalyticsDashboard() {
  const empresa = useSessionStore(selectEmpresa);

  // ── Estado de filtros ────────────────────────────────────────────────────
  const [periodo, setPeriodo]           = useState("all");
  const [tipoEntidad, setTipoEntidad]   = useState("Todos");
  const [textoProducto, setTextoProducto] = useState("");

  // Derivar fechas según el periodo seleccionado
  const periodoData = PERIODOS.find((p) => p.value === periodo) ?? PERIODOS[0];

  // Construir parámetros para el comando Tauri
  const queryParams: AnalyticsParams = {
    empresa_id:     empresa?.id ?? 0,
    fecha_inicio:   periodoData.inicio || undefined,
    fecha_fin:      periodoData.fin    || undefined,
    tipo_entidad:   tipoEntidad !== "Todos" ? tipoEntidad : undefined,
    texto_producto: textoProducto.trim() || undefined,
  };

  // ── Query al backend ─────────────────────────────────────────────────────
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useTauriQuery<AdvancedAnalyticsResult>(
    ["advanced_analytics", queryParams],
    "get_advanced_analytics",
    { params: queryParams },
    { enabled: !!empresa?.id }
  );

  // ── Limpiar todos los filtros ────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setPeriodo("all");
    setTipoEntidad("Todos");
    setTextoProducto("");
  }, []);

  const activeFilters =
    (periodo !== "all" ? 1 : 0) +
    (tipoEntidad !== "Todos" ? 1 : 0) +
    (textoProducto.trim() ? 1 : 0);

  // ── Valores formateados ──────────────────────────────────────────────────
  const totalFacturado     = formatCurrency((data?.total_facturado     ?? 0) / 100);
  const totalBaseImponible = formatCurrency((data?.total_base_imponible ?? 0) / 100);
  const numFacturas        = (data?.num_facturas ?? 0).toLocaleString("es-ES");
  const numLineas          = (data?.num_lineas   ?? 0).toLocaleString("es-ES");

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── Cabecera ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="size-6 text-primary" />
            Analítica Avanzada
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Explora el rendimiento de facturación con filtros combinados.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <Separator />

      {/* ── Barra de filtros ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Filtros</CardTitle>
            {activeFilters > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleReset}
              >
                <FilterX className="size-3.5" />
                Limpiar filtros
                <Badge variant="secondary" className="ml-1 px-1.5 text-xs">
                  {activeFilters}
                </Badge>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Periodo */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filtro-periodo" className="text-xs font-medium">
                Periodo
              </Label>
              <Select value={periodo} onValueChange={setPeriodo}>
                <SelectTrigger id="filtro-periodo" className="h-9 text-sm">
                  <SelectValue placeholder="Selecciona un periodo" />
                </SelectTrigger>
                <SelectContent>
                  {PERIODOS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo de cliente */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filtro-entidad" className="text-xs font-medium">
                Tipo de cliente
              </Label>
              <Select value={tipoEntidad} onValueChange={setTipoEntidad}>
                <SelectTrigger id="filtro-entidad" className="h-9 text-sm">
                  <SelectValue placeholder="Todos los clientes" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ENTIDAD.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Concepto / Producto */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filtro-concepto" className="text-xs font-medium">
                Concepto / Producto
              </Label>
              <Input
                id="filtro-concepto"
                placeholder="Buscar en descripciones…"
                className="h-9 text-sm"
                value={textoProducto}
                onChange={(e) => setTextoProducto(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Estado de carga y error ───────────────────────────────────── */}
      {isError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4 text-sm text-destructive">
            Error al cargar los datos:{" "}
            {typeof error === "object" && error !== null && "message" in error
              ? (error as { message: string }).message
              : "Error desconocido"}
          </CardContent>
        </Card>
      )}

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity duration-300 ${
          isLoading ? "opacity-50" : "opacity-100"
        }`}
      >
        <KpiCard
          title="Total Facturado"
          value={totalFacturado}
          description="IVA incluido, según filtros"
          icon={Euro}
          accent="primary"
        />
        <KpiCard
          title="Base Imponible"
          value={totalBaseImponible}
          description="Sin IVA, según filtros"
          icon={BarChart3}
          accent="emerald"
        />
        <KpiCard
          title="Facturas emitidas"
          value={numFacturas}
          description="Número de facturas únicas"
          icon={FileText}
          accent="violet"
        />
        <KpiCard
          title="Líneas de factura"
          value={numLineas}
          description="Líneas de concepto totales"
          icon={Layers}
          accent="amber"
        />
      </div>

      {/* ── Detalle de filtros activos ────────────────────────────────── */}
      {activeFilters > 0 && (
        <Card className="bg-muted/40">
          <CardContent className="flex flex-wrap gap-2 pt-4">
            <span className="text-xs font-medium text-muted-foreground self-center">
              Filtros activos:
            </span>
            {periodo !== "all" && (
              <Badge variant="outline" className="text-xs">
                {periodoData.label}
              </Badge>
            )}
            {tipoEntidad !== "Todos" && (
              <Badge variant="outline" className="text-xs">
                {tipoEntidad}
              </Badge>
            )}
            {textoProducto.trim() && (
              <Badge variant="outline" className="text-xs">
                Concepto: &ldquo;{textoProducto}&rdquo;
              </Badge>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Nota informativa ─────────────────────────────────────────── */}
      {!empresa?.id && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="pt-4 text-sm text-amber-700 dark:text-amber-400">
            Configura tu empresa en <strong>Configuración</strong> para ver los datos analíticos.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
