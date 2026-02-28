import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Plus,
  FileText,
  Search,
  Printer,
  FileCode2,
  Loader2,
  Landmark,
  RefreshCw,
  QrCode,
  Download,
  FileSearch,
  ExternalLink,
  Eye,
  ArrowUpDown,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { api, QrLegalResponse } from "@/lib/api";
import type { FacturaRow, FacturaDetalle } from "@/lib/api";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import { queryClient } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [sortBy, setSortBy] = useState<"fecha_desc" | "fecha_asc" | "total_desc" | "total_asc" | "cliente_asc">("fecha_desc");
  const [filtroEstado, setFiltroEstado] = useState<"" | "BORRADOR" | "EMITIDA" | "ANULADA">("");
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);
  const [xmlLoadingId, setXmlLoadingId] = useState<number | null>(null);
  const [qrLoadingId, setQrLoadingId] = useState<number | null>(null);
  const [qrDialogData, setQrDialogData] = useState<QrLegalResponse | null>(null);
  const [previewData, setPreviewData] = useState<FacturaDetalle | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [inspeccionLoading, setInspeccionLoading] = useState(false);
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

  const filtered = facturas
    .filter((f) => {
      if (filtroEstado && f.estado !== filtroEstado) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const code = `${f.serie_prefijo}-${f.numero}`.toLowerCase();
      return (
        code.includes(q) ||
        f.cliente_nombre.toLowerCase().includes(q) ||
        f.fecha_emision.includes(q)
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "fecha_desc":
          return b.fecha_emision.localeCompare(a.fecha_emision) || b.id - a.id;
        case "fecha_asc":
          return a.fecha_emision.localeCompare(b.fecha_emision) || a.id - b.id;
        case "total_desc":
          return b.total - a.total;
        case "total_asc":
          return a.total - b.total;
        case "cliente_asc":
          return a.cliente_nombre.localeCompare(b.cliente_nombre, "es");
        default:
          return 0;
      }
    });

  async function handlePdf(f: FacturaRow) {
    if (!empresa) return;
    setActionError(null);
    setPdfLoadingId(f.id);
    try {
      const ruta = await api.generarPdf(f.id, empresa.id);
      toast.success(`PDF generado: ${f.serie_prefijo}-${String(f.numero).padStart(4, "0")}`, {
        description: ruta,
        action: {
          label: "Abrir",
          onClick: () => api.abrirArchivo(ruta),
        },
        duration: 8000,
      });
    } catch (err: unknown) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : String(err);
      setActionError(msg);
      toast.error("Error al generar PDF", { description: msg });
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

  async function handleQr(f: FacturaRow) {
    if (!empresa) return;
    setActionError(null);
    setQrLoadingId(f.id);
    try {
      const data = await api.generarQrLegal(f.id, empresa.id);
      setQrDialogData(data);
    } catch (err: unknown) {
      setActionError(
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : String(err)
      );
    } finally {
      setQrLoadingId(null);
    }
  }

  async function handlePreview(f: FacturaRow) {
    if (!empresa) return;
    setPreviewLoadingId(f.id);
    try {
      const detalle = await api.obtenerFacturaDetalle(f.id, empresa.id);
      setPreviewData(detalle);
    } catch (err: unknown) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : String(err);
      toast.error("Error al cargar la factura", { description: msg });
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function handleInspeccion() {
    if (!empresa) return;
    setActionError(null);
    setInspeccionLoading(true);
    try {
      const anio = new Date().getFullYear();
      const res = await api.generarFicheroInspeccion(empresa.id, anio);
      alert(`Fichero de inspección generado:\n${res.ruta}\n(${res.total_eventos} eventos)`);
    } catch (err: unknown) {
      setActionError(
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : String(err)
      );
    } finally {
      setInspeccionLoading(false);
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={handleInspeccion}
                disabled={inspeccionLoading || !empresa}
              >
                {inspeccionLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileSearch className="size-3.5" />
                )}
                Fichero inspección
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs max-w-[220px] text-center">
              Exporta el XML de auditoría del año actual para Hacienda
            </TooltipContent>
          </Tooltip>
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
                type="search"
                placeholder="Número, cliente, fecha…"
                className="pl-8 h-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              />
            </div>
          </div>
          {/* ── Filtros y orden ── */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/50">
            <span className="text-[11px] text-muted-foreground mr-0.5">Estado:</span>
            {(["", "EMITIDA", "BORRADOR", "ANULADA"] as const).map((estado) => (
              <Button
                key={estado || "todos"}
                size="sm"
                variant={filtroEstado === estado ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setFiltroEstado(estado)}
              >
                {estado === "" ? "Todos" : estado === "EMITIDA" ? "Emitida" : estado === "BORRADOR" ? "Borrador" : "Anulada"}
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <ArrowUpDown className="size-3 text-muted-foreground" />
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="h-6 text-[11px] w-44 border-0 bg-muted/50 px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fecha_desc">Fecha (más reciente)</SelectItem>
                  <SelectItem value="fecha_asc">Fecha (más antigua)</SelectItem>
                  <SelectItem value="total_desc">Importe (mayor)</SelectItem>
                  <SelectItem value="total_asc">Importe (menor)</SelectItem>
                  <SelectItem value="cliente_asc">Cliente (A–Z)</SelectItem>
                </SelectContent>
              </Select>
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
            <div className="overflow-x-auto">
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
                  <TableHead className="text-xs text-right w-28">Acciones</TableHead>
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
                        {/* Botón Ver detalle */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "size-7 opacity-0 group-hover:opacity-100 transition-opacity",
                                previewLoadingId === f.id && "opacity-100"
                              )}
                              disabled={previewLoadingId === f.id}
                              onClick={() => handlePreview(f)}
                            >
                              {previewLoadingId === f.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Eye className="size-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Ver detalle
                          </TooltipContent>
                        </Tooltip>
                        {/* Botón PDF */}
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

                        {/* QR técnico de notariado AEAT */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "size-7 opacity-0 group-hover:opacity-100 transition-opacity text-sky-600 hover:text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/40",
                                qrLoadingId === f.id && "opacity-100"
                              )}
                              disabled={qrLoadingId === f.id}
                              onClick={() => handleQr(f)}
                            >
                              {qrLoadingId === f.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <QrCode className="size-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            QR de verificación tributaria (AEAT)
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Diálogo Vista Previa de Factura ──────────────────────── */}
      <Dialog open={!!previewData} onOpenChange={(open) => !open && setPreviewData(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              {previewData && (
                <>
                  Factura {previewData.serie_prefijo}-{String(previewData.numero).padStart(4, "0")}
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Detalle de la factura antes de generar el documento
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4 pt-1">
              {/* Cabecera de la factura */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Cliente</p>
                  <p className="text-muted-foreground">{previewData.cliente_nombre}</p>
                  {previewData.cliente_nif && (
                    <p className="text-muted-foreground font-mono">{previewData.cliente_nif}</p>
                  )}
                </div>
                <div className="space-y-1 text-right">
                  <p className="font-medium text-foreground">Fecha de emisión</p>
                  <p className="text-muted-foreground">{formatDate(previewData.fecha_emision)}</p>
                  <div>{estadoBadge(previewData.estado)}</div>
                </div>
              </div>

              {/* Líneas de factura */}
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-[11px] py-2">Descripción</TableHead>
                      <TableHead className="text-[11px] py-2 text-right w-16">Cant.</TableHead>
                      <TableHead className="text-[11px] py-2 text-right w-24">P. Unit.</TableHead>
                      <TableHead className="text-[11px] py-2 text-right w-16">IVA</TableHead>
                      <TableHead className="text-[11px] py-2 text-right w-24">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.lineas.map((linea) => (
                      <TableRow key={linea.id}>
                        <TableCell className="text-xs py-2">{linea.descripcion}</TableCell>
                        <TableCell className="text-xs py-2 text-right tabular-nums">
                          {linea.cantidad % 1 === 0
                            ? linea.cantidad
                            : linea.cantidad.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs py-2 text-right tabular-nums">
                          {formatCurrency(linea.precio_unitario / 100)}
                        </TableCell>
                        <TableCell className="text-xs py-2 text-right tabular-nums text-muted-foreground">
                          {linea.tipo_iva}%
                        </TableCell>
                        <TableCell className="text-xs py-2 text-right tabular-nums font-medium">
                          {formatCurrency(linea.total_linea / 100)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totales */}
              <div className="flex justify-end">
                <div className="w-56 space-y-1.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Base imponible</span>
                    <span className="tabular-nums">{formatCurrency(previewData.subtotal / 100)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>IVA</span>
                    <span className="tabular-nums">{formatCurrency(previewData.total_impuestos / 100)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1.5">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(previewData.total / 100)}</span>
                  </div>
                </div>
              </div>

              {/* Acciones */}
              <div className="flex justify-end gap-2 pt-1 border-t border-border">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-xs"
                  disabled={pdfLoadingId === previewData.id}
                  onClick={() => {
                    const f = facturas.find((x) => x.id === previewData.id);
                    if (f) { handlePdf(f); setPreviewData(null); }
                  }}
                >
                  {pdfLoadingId === previewData.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Printer className="size-3.5" />
                  )}
                  Generar PDF
                </Button>
                {previewData.es_entidad_publica === 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 text-xs text-amber-600 hover:text-amber-700 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/40"
                    disabled={xmlLoadingId === previewData.id}
                    onClick={() => {
                      const f = facturas.find((x) => x.id === previewData.id);
                      if (f) { handleFacturae(f); setPreviewData(null); }
                    }}
                  >
                    {xmlLoadingId === previewData.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <FileCode2 className="size-3.5" />
                    )}
                    Generar Facturae
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Diálogo QR de notariado AEAT ─────────────────────────── */}
      <Dialog open={!!qrDialogData} onOpenChange={(open) => !open && setQrDialogData(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="size-4 text-sky-600" />
              QR de Verificación Tributaria
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Código QR de notariado AEAT conforme al RD 1007/2023 (Veri*factu).
              Incorpóralo en el PDF de la factura para que el receptor pueda
              verificar su autenticidad en la sede de la AEAT.
            </DialogDescription>
          </DialogHeader>

          {qrDialogData && (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="rounded-xl border border-border p-3 bg-white shadow-sm">
                <img
                  src={qrDialogData.svg_data_url}
                  alt="QR de verificación AEAT"
                  className="w-48 h-48"
                />
              </div>

              <Badge className="gap-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border-0 text-[10px] font-mono select-all">
                Estado: Registro Seguro (No Veri*factu)
              </Badge>

              <p className="text-[10px] text-center text-muted-foreground font-mono break-all px-2 leading-relaxed">
                {qrDialogData.url}
              </p>

              <div className="flex gap-2 w-full">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 text-xs"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = qrDialogData.svg_data_url;
                    a.download = "qr-verificacion-aeat.png";
                    a.click();
                  }}
                >
                  <Download className="size-3.5" />
                  Descargar PNG
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 text-xs"
                  onClick={() => window.open(qrDialogData.url, "_blank")}
                >
                  <ExternalLink className="size-3.5" />
                  Abrir en AEAT
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

