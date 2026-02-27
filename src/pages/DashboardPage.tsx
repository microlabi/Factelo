import { Link } from "react-router-dom";
import {
  TrendingUp,
  TrendingDown,
  FileText,
  Clock,
  Euro,
  BarChart3,
  RefreshCw,
  Landmark,
  ShieldCheck,
  CalendarDays,
} from "lucide-react";
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
import { StatCard } from "@/components/dashboard/StatCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { RecentInvoices } from "@/components/dashboard/RecentInvoices";
import { formatCurrency } from "@/lib/utils";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import { useTauriQuery } from "@/hooks/useTauriCommand";
import type { DashboardStats } from "@/lib/api";

const EMPTY_STATS: DashboardStats = {
  total_facturado_centimos: 0,
  iva_repercutido_centimos: 0,
  iva_soportado_centimos: 0,
  facturas_pendientes: 0,
  facturas_emitidas_mes: 0,
  variacion_mensual_pct: 0,
};

// ─── IVA Balance mini card ────────────────────────────────────────────────────

interface IvaRowProps {
  label: string;
  value: number;
  color: "emerald" | "red";
}

function IvaRow({ label, value, color, maxVal }: IvaRowProps & { maxVal: number }) {
  const colorClass =
    color === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  const barClass =
    color === "emerald"
      ? "bg-emerald-500 dark:bg-emerald-500"
      : "bg-red-500 dark:bg-red-500";
  const percentage = maxVal > 0 ? (value / maxVal) * 100 : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={`text-sm font-semibold ${colorClass}`}>
          {formatCurrency(value)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${barClass} transition-all duration-700`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const empresa = useSessionStore(selectEmpresa);
  const empresaId = empresa?.id;

  const { data: statsData = EMPTY_STATS } = useTauriQuery<DashboardStats>(
    ["dashboard_stats", empresaId],
    "obtener_dashboard_stats",
    empresaId ? { empresaId } : undefined,
    { enabled: !!empresaId }
  );

  const stats = {
    total_facturado: statsData.total_facturado_centimos / 100,
    iva_repercutido: statsData.iva_repercutido_centimos / 100,
    iva_soportado: statsData.iva_soportado_centimos / 100,
    facturas_pendientes: statsData.facturas_pendientes,
    facturas_emitidas_mes: statsData.facturas_emitidas_mes,
    variacion_mensual_pct: statsData.variacion_mensual_pct,
  };

  const ivaMax = Math.max(stats.iva_repercutido, stats.iva_soportado, 0);
  const currentMonth = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(new Date());

  const ivaLiquidar = stats.iva_repercutido - stats.iva_soportado;

  return (
    <div className="space-y-6">
      {/* ── Saludo contextual ──────────────────────────────────────── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Buenos días,{" "}
            <span className="text-primary">{empresa?.nombre ?? "usuario"}</span>
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
            <CalendarDays className="size-3.5" />
            <span className="capitalize">{currentMonth}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <RefreshCw className="size-3.5" />
            Actualizar
          </Button>
          <Button size="sm" className="gap-1.5 text-xs" asChild>
            <Link to="/facturas/nueva">
              <FileText className="size-3.5" />
              Nueva factura
            </Link>
          </Button>
        </div>
      </div>

      {/* ── KPI Grid — 4 tarjetas ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total facturado (año)"
          value={formatCurrency(stats.total_facturado)}
          description="Acumulado ejercicio fiscal 2026"
          trend={{
            value: stats.variacion_mensual_pct,
            label: "vs. mes anterior",
          }}
          icon={Euro}
          iconClassName="bg-primary"
        />

        <StatCard
          title="IVA repercutido"
          value={formatCurrency(stats.iva_repercutido)}
          description="IVA cobrado a clientes (21%)"
          trend={{ value: stats.variacion_mensual_pct, label: "vs. mes anterior" }}
          icon={TrendingUp}
          iconClassName="bg-emerald-500"
        />

        <StatCard
          title="IVA soportado"
          value={formatCurrency(stats.iva_soportado)}
          description="IVA pagado en gastos"
          trend={{ value: 0, label: "vs. mes anterior" }}
          icon={TrendingDown}
          iconClassName="bg-rose-500"
        />

        <StatCard
          title="Facturas pendientes"
          value={String(stats.facturas_pendientes)}
          description={`${stats.facturas_emitidas_mes} emitidas este mes`}
          trend={{ value: 0, label: "sin cambios" }}
          icon={Clock}
          iconClassName="bg-amber-500"
        />
      </div>

      {/* ── Fila 2: Gráfico + IVA Balance ───────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Gráfico evolución facturación */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  Evolución de facturación
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Ingresos vs. gastos · últimos 6 meses
                </CardDescription>
              </div>
              <Badge variant="secondary" className="text-xs">
                <BarChart3 className="mr-1 size-3" />
                2026
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <RevenueChart />
          </CardContent>
        </Card>

        {/* Panel IVA */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="size-4 text-muted-foreground" />
              Balance de IVA
            </CardTitle>
            <CardDescription>Situación trimestral estimada</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <IvaRow
              label="IVA repercutido (cobrado)"
              value={stats.iva_repercutido}
              color="emerald"
              maxVal={ivaMax}
            />
            <IvaRow
              label="IVA soportado (deducible)"
              value={stats.iva_soportado}
              color="red"
              maxVal={ivaMax}
            />

            <Separator />

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                IVA a liquidar (modelo 303)
              </p>
              <p
                className={`mt-1 text-xl font-bold ${
                  ivaLiquidar >= 0
                    ? "text-foreground"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {formatCurrency(Math.abs(ivaLiquidar))}
                {ivaLiquidar < 0 && (
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    (a favor)
                  </span>
                )}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Próxima liquidación: 20 abr 2026
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                Todas las facturas incluyen{" "}
                <span className="font-semibold">hash encadenado VeriFactu</span>{" "}
                y están listas para envío a FACe.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Fila 3: Facturas recientes ──────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Facturas recientes</CardTitle>
              <CardDescription className="mt-0.5">
                Últimas {5} facturas registradas
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="gap-1 text-xs font-medium"
            >
              <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
              VeriFactu activo
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <RecentInvoices />
        </CardContent>
      </Card>
    </div>
  );
}
