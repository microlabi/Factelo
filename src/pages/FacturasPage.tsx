import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  FileText,
  Search,
  Printer,
  FileCode2,
  Loader2,
  Landmark,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { api } from "@/lib/api";
import type { FacturaRow } from "@/lib/api";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import { queryClient } from "@/lib/queryClient";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function estadoBadge(estado: string) {
  switch (estado) {
    case "EMITIDA":
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border-0 text-[11px]">
          Emitida
        </Badge>
      );
    case "BORRADOR":
      return (
        <Badge variant="secondary" className="text-[11px]">
          Borrador
        </Badge>
      );
    case "ANULADA":
      return (
        <Badge variant="destructive" className="text-[11px]">
          Anulada
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-[11px]">{estado}</Badge>;
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function FacturasPage() {
  const empresa = useSessionStore(selectEmpresa);
  const [search, setSearch] = useState("");
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);
  const [xmlLoadingId, setXmlLoadingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const cargarFacturas = useCallback(async () => {
    if (!empresa) return;
    setIsLoading(true);
    setFetchError(null);
    try {
      const data = await api.listarFacturas(empresa.id);
      setFacturas(data);
      // Sincronizar también el caché de React Query
      queryClient.setQueryData(["facturas", empresa.id], data);
    } catch (err: unknown) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : String(err);
      setFetchError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [empresa]);

  // Carga inicial y cuando empresa cambia
  useEffect(() => {
    cargarFacturas();
  }, [cargarFacturas]);

  // Recargar cuando React Query invalide la clave "facturas"
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        Array.isArray(event.query.queryKey) &&
        event.query.queryKey[0] === "facturas" &&
        event.query.state.isInvalidated
      ) {
        cargarFacturas();
      }
    });
    return unsubscribe;
  }, [cargarFacturas]);

  const filtered = facturas.filter((f) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const code = `${f.serie_prefijo}-${f.numero}`.toLowerCase();
    return (
      code.includes(q) ||
      f.cliente_nombre.toLowerCase().includes(q) ||
      f.fecha_emision.includes(q)
    );
  });

  async function handlePdf(f: FacturaRow) {
    if (!empresa) return;
    setActionError(null);
    setPdfLoadingId(f.id);
    try {
      await api.generarPdf(f.id, empresa.id);
    } catch (err: unknown) {
      setActionError(
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : String(err)
      );
    } finally {
      setPdfLoadingId(null);
    }
  }

  async function handleFacturae(f: FacturaRow) {
    if (!empresa) return;
    setActionError(null);
    setXmlLoadingId(f.id);
    try {
      await api.generarFacturaeAutofirma(f.id, empresa.id);
    } catch (err: unknown) {
      setActionError(
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : String(err)
      );
    } finally {
      setXmlLoadingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* guard empresa */}
      {!empresa && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
          <Loader2 className="size-3.5 animate-spin shrink-0" />
          Cargando sesión de empresa…
        </div>
      )}
      {/* Cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Facturas</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isLoading
              ? "Cargando…"
              : facturas.length === 0
              ? "Aún no hay facturas emitidas"
              : `${facturas.length} factura${facturas.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={cargarFacturas}
            disabled={isLoading}
          >
            <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
            Actualizar
          </Button>
          <Button asChild size="sm" className="gap-2">
            <Link to="/facturas/nueva">
              <Plus className="size-3.5" />
              Nueva factura
            </Link>
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      )}

      {fetchError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <strong>Error al cargar facturas:</strong> {fetchError}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Historial de facturas</CardTitle>
              <CardDescription className="text-xs">
                Todas las facturas de tu empresa
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Número, cliente, fecha…"
                className="pl-8 h-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando facturas…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FileText className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {search ? "Sin resultados" : "Ninguna factura todavía"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {search
                    ? "Prueba con otro término de búsqueda"
                    : "Crea tu primera factura con el botón de arriba"}
                </p>
              </div>
              {!search && (
                <Button asChild size="sm" variant="outline" className="gap-2 mt-1">
                  <Link to="/facturas/nueva">
                    <Plus className="size-3.5" />
                    Nueva factura
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-32">Número</TableHead>
                  <TableHead className="text-xs w-24">Fecha</TableHead>
                  <TableHead className="text-xs">Cliente</TableHead>
                  <TableHead className="text-xs text-right w-24">Base</TableHead>
                  <TableHead className="text-xs text-right w-20">IVA</TableHead>
                  <TableHead className="text-xs text-right w-24">Total</TableHead>
                  <TableHead className="text-xs w-24">Estado</TableHead>
                  <TableHead className="text-xs text-right w-20">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((f) => (
                  <TableRow key={f.id} className="group">
                    <TableCell className="font-mono text-xs font-medium">
                      <div className="flex items-center gap-1.5">
                        {f.es_entidad_publica === 1 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Landmark className="size-3 text-amber-500 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Entidad pública — Facturae
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {f.serie_prefijo}-{String(f.numero).padStart(4, "0")}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(f.fecha_emision)}
                    </TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">
                      {f.cliente_nombre}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {formatCurrency(f.subtotal / 100)}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                      {formatCurrency(f.total_impuestos / 100)}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums font-semibold">
                      {formatCurrency(f.total / 100)}
                    </TableCell>
                    <TableCell>{estadoBadge(f.estado)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "size-7 opacity-0 group-hover:opacity-100 transition-opacity",
                                pdfLoadingId === f.id && "opacity-100"
                              )}
                              disabled={pdfLoadingId === f.id || xmlLoadingId === f.id}
                              onClick={() => handlePdf(f)}
                            >
                              {pdfLoadingId === f.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Printer className="size-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Generar PDF
                          </TooltipContent>
                        </Tooltip>

                        {f.es_entidad_publica === 1 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  "size-7 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40",
                                  xmlLoadingId === f.id && "opacity-100"
                                )}
                                disabled={pdfLoadingId === f.id || xmlLoadingId === f.id}
                                onClick={() => handleFacturae(f)}
                              >
                                {xmlLoadingId === f.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <FileCode2 className="size-3.5" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Generar Facturae (XML firmado)
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

