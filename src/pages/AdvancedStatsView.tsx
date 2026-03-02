import { useState } from "react";
import {
  BarChart3,
  Download,
  Info,
  Loader2,
  RefreshCw,
  TrendingUp,
  Users,
  AlarmClock,
  LayoutGrid,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
  Label,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTauriQuery } from "@/hooks/useTauriCommand";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import { api, type AdvancedStatisticsResult, type AbcClienteRow } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
    if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
      return `Código ${(error as { code: string }).code}`;
    }
  }
  return "Error desconocido";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ABC_COLORS: Record<string, string> = {
  A: "#22c55e",
  B: "#3b82f6",
  C: "#9ca3af",
};
const ABC_BG: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  C: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};
const RISK_BG: Record<string, string> = {
  Bajo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Medio: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Alto: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};
const RISK_DOT: Record<string, string> = {
  Bajo: "#22c55e",
  Medio: "#f59e0b",
  Alto: "#ef4444",
};

/** Intensidades del heatmap: 0–4 */
function heatLevel(val: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (val === 0 || max === 0) return 0;
  const pct = val / max;
  if (pct < 0.2) return 1;
  if (pct < 0.45) return 2;
  if (pct < 0.7) return 3;
  return 4;
}
const HEAT_CLS = [
  "bg-muted/30 text-muted-foreground/30",
  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-blue-300 text-blue-800 dark:bg-blue-700/50 dark:text-blue-200",
  "bg-blue-500 text-white dark:bg-blue-600",
  "bg-blue-700 text-white dark:bg-blue-800",
];

function truncateName(name: string, max = 16) {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel 1 – Pareto (ComposedChart)
// ─────────────────────────────────────────────────────────────────────────────

function ParetoPanel({ rows }: { rows: AbcClienteRow[] }) {
  const data = rows.map((r) => ({
    name: truncateName(r.cliente_nombre),
    fullName: r.cliente_nombre,
    facturado: r.total_facturado / 100,
    acumulado: r.porcentaje_acumulado,
    clase: r.clase_abc,
  }));

  const totalA = rows.filter((r) => r.clase_abc === "A").length;
  const totalB = rows.filter((r) => r.clase_abc === "B").length;
  const totalC = rows.filter((r) => r.clase_abc === "C").length;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-primary" />
              Dependencia de Clientes — Ley de Pareto
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Barras = facturación por cliente · Línea = % acumulado (eje derecho)
            </CardDescription>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {(["A", "B", "C"] as const).map((cls) => (
              <span
                key={cls}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ABC_BG[cls]}`}
              >
                {cls}:{" "}
                {cls === "A" ? totalA : cls === "B" ? totalB : totalC}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4 flex-1 min-h-0">
        {data.length === 0 ? (
          <EmptyState message="No hay facturas para calcular el análisis ABC." />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 40, bottom: 60, left: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                interval={0}
                height={65}
              />
              {/* Eje izquierdo: importe */}
              <YAxis
                yAxisId="left"
                tickFormatter={(v) => `${(v as number).toLocaleString("es-ES")} €`}
                tick={{ fontSize: 10 }}
                width={70}
              />
              {/* Eje derecho: % acumulado */}
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10 }}
                width={42}
              />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload as (typeof data)[0];
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 shadow text-xs">
                      <p className="font-semibold mb-1">{d.fullName}</p>
                      <p>
                        Facturado:{" "}
                        <strong>
                          {formatCurrency(Math.round(d.facturado * 100))}
                        </strong>
                      </p>
                      <p>
                        % acumulado:{" "}
                        <strong>{d.acumulado}%</strong>
                      </p>
                      <p>
                        Clase:{" "}
                        <span className={`font-bold ${d.clase === "A" ? "text-emerald-600" : d.clase === "B" ? "text-blue-600" : "text-gray-500"}`}>
                          {d.clase}
                        </span>
                      </p>
                    </div>
                  );
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                payload={[
                  { value: "Facturado (€)", type: "rect", color: "#6366f1" },
                  { value: "% Acumulado", type: "line", color: "#f59e0b" },
                ]}
              />
              <Bar yAxisId="left" dataKey="facturado" radius={[3, 3, 0, 0]}>
                {data.map((entry, idx) => (
                  <Cell key={idx} fill={ABC_COLORS[entry.clase] ?? "#6366f1"} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="acumulado"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#f59e0b" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Tabla resumen ABC */}
        {rows.length > 0 && (
          <div className="mt-4 rounded-lg border overflow-auto max-h-52">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/70">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">#</th>
                  <th className="px-3 py-2 text-left font-semibold">Cliente</th>
                  <th className="px-3 py-2 text-right font-semibold">Facturado</th>
                  <th className="px-3 py-2 text-right font-semibold">% s/Total</th>
                  <th className="px-3 py-2 text-right font-semibold">% Acum.</th>
                  <th className="px-3 py-2 text-right font-semibold">Clase</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td
                      className="px-3 py-1.5 font-medium max-w-[180px] truncate"
                      title={r.cliente_nombre}
                    >
                      {r.cliente_nombre}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCurrency(r.total_facturado)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.porcentaje_sobre_total}%
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.porcentaje_acumulado}%
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${ABC_BG[r.clase_abc]}`}
                      >
                        {r.clase_abc}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel 2 – DSO Predictivo (ScatterChart + tabla)
// ─────────────────────────────────────────────────────────────────────────────

function DsoPanel({ rows }: { rows: AdvancedStatisticsResult["dso"] }) {
  const scatterData = rows.map((r) => ({
    x: r.total_facturado / 100,
    y: r.retraso_medio_dias,
    z: 200,
    riesgo: r.riesgo,
    nombre: r.cliente_nombre,
  }));

  const alto = rows.filter((r) => r.riesgo === "Alto").length;
  const medio = rows.filter((r) => r.riesgo === "Medio").length;
  const bajo = rows.filter((r) => r.riesgo === "Bajo").length;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlarmClock className="size-4 text-primary" />
              Riesgo de Cobro y Tesorería — DSO Predictivo
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Eje X = volumen facturado (€) · Eje Y = plazo medio de cobro (días)
            </CardDescription>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {(["Bajo", "Medio", "Alto"] as const).map((r) => (
              <span
                key={r}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK_BG[r]}`}
              >
                {r}:{" "}
                {r === "Bajo" ? bajo : r === "Medio" ? medio : alto}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4 flex-1 min-h-0">
        {scatterData.length === 0 ? (
          <EmptyState message="No hay datos para calcular el DSO." />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 8, right: 32, bottom: 24, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="x"
                type="number"
                name="Facturado"
                tickFormatter={(v) =>
                  `${(v as number).toLocaleString("es-ES")} €`
                }
                tick={{ fontSize: 10 }}
              >
                <Label
                  value="Volumen facturado (€)"
                  position="insideBottom"
                  offset={-12}
                  style={{ fontSize: 10, fill: "#888" }}
                />
              </XAxis>
              <YAxis
                dataKey="y"
                type="number"
                name="Días"
                tickFormatter={(v) => `${v}d`}
                tick={{ fontSize: 10 }}
                width={38}
              >
                <Label
                  value="Plazo medio (días)"
                  angle={-90}
                  position="insideLeft"
                  offset={12}
                  style={{ fontSize: 10, fill: "#888" }}
                />
              </YAxis>
              <ZAxis dataKey="z" range={[60, 200]} />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload as (typeof scatterData)[0];
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 shadow text-xs">
                      <p className="font-semibold mb-1">{d.nombre}</p>
                      <p>
                        Facturado:{" "}
                        <strong>
                          {formatCurrency(Math.round(d.x * 100))}
                        </strong>
                      </p>
                      <p>
                        Plazo medio:{" "}
                        <strong>{d.y} días</strong>
                      </p>
                      <p>
                        Riesgo:{" "}
                        <span
                          className={`font-bold ${
                            d.riesgo === "Alto"
                              ? "text-red-600"
                              : d.riesgo === "Medio"
                              ? "text-amber-600"
                              : "text-emerald-600"
                          }`}
                        >
                          {d.riesgo}
                        </span>
                      </p>
                    </div>
                  );
                }}
              />
              {/* Un Scatter por cada nivel de riesgo para colores distintos */}
              {(["Bajo", "Medio", "Alto"] as const).map((riesgo) => (
                <Scatter
                  key={riesgo}
                  name={`Riesgo ${riesgo}`}
                  data={scatterData.filter((d) => d.riesgo === riesgo)}
                  fill={RISK_DOT[riesgo]}
                  opacity={0.85}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        )}

        {/* Tabla DSO */}
        {rows.length > 0 && (
          <div className="mt-4 rounded-lg border overflow-auto max-h-52">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/70">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Cliente</th>
                  <th className="px-3 py-2 text-right font-semibold">Facturado</th>
                  <th className="px-3 py-2 text-right font-semibold">Plazo medio</th>
                  <th className="px-3 py-2 text-right font-semibold">Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                    <td
                      className="px-3 py-1.5 font-medium max-w-[200px] truncate"
                      title={r.cliente_nombre}
                    >
                      {r.cliente_nombre}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCurrency(r.total_facturado)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.retraso_medio_dias} días
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${RISK_BG[r.riesgo]}`}
                      >
                        {r.riesgo}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel 3 – Heatmap Temporal
// ─────────────────────────────────────────────────────────────────────────────

function HeatmapPanel({
  rows,
}: {
  rows: AdvancedStatisticsResult["heatmap"];
}) {
  // Derivar meses y conceptos únicos
  const meses = [
    ...new Set(rows.map((r) => r.anio_mes)),
  ].sort();

  const conceptos = (() => {
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.concepto) && seen.add(r.concepto)).map(
      (r) => r.concepto
    );
  })();

  const lookup = new Map(
    rows.map((r) => [`${r.concepto}|${r.anio_mes}`, r.total_facturado])
  );

  const maxVal = Math.max(...rows.map((r) => r.total_facturado), 1);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <LayoutGrid className="size-4 text-primary" />
              Mapa de Calor de Ventas
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Top 8 conceptos de facturación · Intensidad del azul proporcional al volumen mensual (€)
            </CardDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[220px] text-xs">
              Cada celda muestra la facturación del concepto en ese mes. A más oscuro,
              mayor es el importe facturado.
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4 flex-1 min-h-0">
        {rows.length === 0 ? (
          <EmptyState message="No hay datos para construir el mapa de calor." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-background px-3 py-2 text-left font-semibold min-w-[160px] border-b">
                    Concepto
                  </th>
                  {meses.map((mes) => (
                    <th
                      key={mes}
                      className="px-2 py-2 text-center font-semibold whitespace-nowrap border-b min-w-[80px]"
                    >
                      {mes}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conceptos.map((concepto) => (
                  <tr key={concepto} className="border-b last:border-0">
                    <td
                      className="sticky left-0 bg-background px-3 py-1.5 font-medium max-w-[200px] truncate"
                      title={concepto}
                    >
                      {concepto}
                    </td>
                    {meses.map((mes) => {
                      const val = lookup.get(`${concepto}|${mes}`) ?? 0;
                      const level = heatLevel(val, maxVal);
                      return (
                        <td
                          key={mes}
                          title={val > 0 ? formatCurrency(val) : "Sin datos"}
                          className={`px-2 py-1.5 text-center tabular-nums rounded transition-colors ${HEAT_CLS[level]}`}
                        >
                          {val > 0 ? formatCurrency(val) : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Leyenda de colores */}
        {rows.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground justify-end">
            <span>Bajo</span>
            {HEAT_CLS.slice(1).map((cls, i) => (
              <div key={i} className={`size-4 rounded ${cls}`} />
            ))}
            <span>Alto</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state helper
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <BarChart3 className="size-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Summary Bar
// ─────────────────────────────────────────────────────────────────────────────

function KpiBar({ data }: { data: AdvancedStatisticsResult }) {
  const totalFacturado = data.abc.reduce((s, r) => s + r.total_facturado, 0);
  const clientes = data.abc.length;
  const clientes_a = data.abc.filter((r) => r.clase_abc === "A").length;
  const alto_riesgo = data.dso.filter((r) => r.riesgo === "Alto").length;

  const kpis = [
    {
      label: "Total Facturado",
      value: formatCurrency(totalFacturado),
      icon: TrendingUp,
      accent: "text-primary",
    },
    {
      label: "Clientes analizados",
      value: clientes.toString(),
      icon: Users,
      accent: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "Clientes Clase A",
      value: clientes_a.toString(),
      sub: `generan ≥80% del revenue`,
      icon: BarChart3,
      accent: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Riesgo de Cobro Alto",
      value: alto_riesgo.toString(),
      sub: `clientes con >60 días`,
      icon: AlarmClock,
      accent: alto_riesgo > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
      {kpis.map(({ label, value, sub, icon: Icon, accent }) => (
        <Card key={label} className="py-4 px-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground font-medium">{label}</span>
            <Icon className={`size-4 ${accent}`} />
          </div>
          <div className={`text-2xl font-bold ${accent}`}>{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────────────────

export function AdvancedStatsView() {
  const empresa = useSessionStore(selectEmpresa);
  const empresaId = empresa?.id ?? 0;
  const empresaNombre = empresa?.nombre ?? "Mi empresa";

  const [pdfLoading, setPdfLoading] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useTauriQuery<AdvancedStatisticsResult>(
    ["advanced-statistics", empresaId],
    "get_advanced_statistics",
    { empresaId },
    { enabled: empresaId > 0 }
  );

  // ── Exportar PDF ────────────────────────────────────────────────────────────
  async function handleExportPdf() {
    if (!data) return;
    setPdfLoading(true);
    try {
      const path = await api.generateAdvancedStatsPdf({
        empresa_id: empresaId,
        empresa_nombre: empresaNombre,
        abc: data.abc,
        dso: data.dso,
        heatmap: data.heatmap,
      });
      await api.abrirArchivo(path);
      toast.success("Informe ejecutivo generado", {
        description: path.split(/[\\/]/).pop(),
      });
    } catch (e) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? (e as { message: string }).message
          : "Error desconocido";
      toast.error("No se pudo generar el PDF", { description: msg });
    } finally {
      setPdfLoading(false);
    }
  }

  // ── Render estados ─────────────────────────────────────────────────────────
  if (!empresaId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <BarChart3 className="size-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Selecciona una empresa para ver las estadísticas avanzadas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">

      {/* ── Cabecera de página ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" />
            Informes Estadísticos Avanzados
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Análisis de Pareto · DSO Predictivo · Heatmap Temporal
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`size-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`}
            />
            Actualizar
          </Button>
          <Button
            size="sm"
            onClick={handleExportPdf}
            disabled={pdfLoading || isLoading || !data}
          >
            {pdfLoading ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="size-3.5 mr-1.5" />
            )}
            {pdfLoading ? "Generando…" : "Generar Informe Ejecutivo (PDF)"}
          </Button>
        </div>
      </div>

      {/* ── Loading / Error ─────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Calculando estadísticas…</span>
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <strong>Error al cargar los datos: </strong>
          {getErrorMessage(error)}
        </div>
      )}

      {/* ── Datos ──────────────────────────────────────────────────────────── */}
      {data && (
        <>
          <KpiBar data={data} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ParetoPanel rows={data.abc} />
            <DsoPanel rows={data.dso} />
          </div>

          <HeatmapPanel rows={data.heatmap} />
        </>
      )}
    </div>
  );
}
