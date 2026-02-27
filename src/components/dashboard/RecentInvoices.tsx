import React from "react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import type { EstadoFactura } from "@/types";

interface RecentInvoice {
  id: number;
  numero: number;
  serie: string;
  cliente_nombre: string;
  fecha_emision: string;
  total: number;
  estado: EstadoFactura;
}

const BADGE_VARIANT: Record<
  EstadoFactura,
  "success" | "warning" | "destructive" | "secondary"
> = {
  EMITIDA: "success",
  BORRADOR: "warning",
  ANULADA: "destructive",
};

const ESTADO_LABEL: Record<EstadoFactura, string> = {
  EMITIDA: "Emitida",
  BORRADOR: "Borrador",
  ANULADA: "Anulada",
};

// Datos de muestra
const SAMPLE_INVOICES: RecentInvoice[] = [
  {
    id: 1,
    numero: 42,
    serie: "FAC",
    cliente_nombre: "Innovatech Solutions SL",
    fecha_emision: "2026-02-24",
    total: 4_840.0,
    estado: "EMITIDA",
  },
  {
    id: 2,
    numero: 41,
    serie: "FAC",
    cliente_nombre: "Construcciones García e Hijos",
    fecha_emision: "2026-02-20",
    total: 12_100.0,
    estado: "EMITIDA",
  },
  {
    id: 3,
    numero: 40,
    serie: "FAC",
    cliente_nombre: "Digital Media Group SA",
    fecha_emision: "2026-02-18",
    total: 2_178.0,
    estado: "BORRADOR",
  },
  {
    id: 4,
    numero: 39,
    serie: "FAC",
    cliente_nombre: "Despacho Legal Martínez",
    fecha_emision: "2026-02-15",
    total: 726.0,
    estado: "EMITIDA",
  },
  {
    id: 5,
    numero: 38,
    serie: "FAC",
    cliente_nombre: "Restaurante El Mirador",
    fecha_emision: "2026-02-10",
    total: 968.0,
    estado: "ANULADA",
  },
];

interface RecentInvoicesProps {
  invoices?: RecentInvoice[];
  loading?: boolean;
}

export function RecentInvoices({
  invoices = SAMPLE_INVOICES,
  loading = false,
}: RecentInvoicesProps) {
  if (loading) {
    return (
      <div className="space-y-3 px-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-3.5 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="divide-y">
        {invoices.map((inv) => (
          <div
            key={inv.id}
            className="group flex items-center gap-4 py-3 transition-colors hover:bg-muted/30 px-1 rounded-lg"
          >
            {/* Ícono */}
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <FileText className="size-4 text-muted-foreground" />
            </div>

            {/* Info factura */}
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-foreground leading-none">
                {inv.cliente_nombre}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {inv.serie}-{String(inv.numero).padStart(4, "0")} ·{" "}
                {formatDate(inv.fecha_emision)}
              </p>
            </div>

            {/* Estado */}
            <Badge
              variant={BADGE_VARIANT[inv.estado]}
              className="hidden sm:inline-flex shrink-0"
            >
              {ESTADO_LABEL[inv.estado]}
            </Badge>

            {/* Importe */}
            <span
              className={cn(
                "shrink-0 text-sm font-semibold tabular-nums",
                inv.estado === "ANULADA"
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              )}
            >
              {formatCurrency(inv.total)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
          <Link to="/facturas">
            Ver todas las facturas
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
