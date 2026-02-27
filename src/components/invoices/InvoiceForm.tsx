import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, useFieldArray, FormProvider, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Save,
  FileCode2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FileText,
  User,
  CalendarDays,
  Hash,
  StickyNote,
  Info,
  ShieldAlert,
  Building2,
  Landmark,
  FolderOpen,
  GitBranch,
  UserCheck,
  AlertTriangle,
  ShieldCheck,
  PenLine,
} from "lucide-react";

import { api } from "@/lib/api";
import type { ClienteRow, SerieRow } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import {
  invoiceFormSchema,
  defaultInvoiceLine,
  defaultInvoiceFormValues,
  TIPOS_RECTIFICATIVA,
  type InvoiceFormValues,
} from "@/lib/schemas/invoiceSchema";
import { calcLine, useInvoiceTotals } from "@/hooks/useInvoiceTotals";
import { formatCurrency, cn } from "@/lib/utils";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import type { ApiError } from "@/hooks/useTauriCommand";

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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTauriQuery } from "@/hooks/useTauriCommand";
import { InvoiceLineRow } from "./InvoiceLineRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface InsertFacturaInput {
  empresa_id: number;
  cliente_id: number;
  serie_id: number;
  numero: number;
  fecha_emision: string;
  /** Céntimos (integer) */
  subtotal: number;
  /** Céntimos (integer) */
  total_impuestos: number;
  /** Céntimos (integer) */
  total: number;
  estado: string;
  firma_app: string | null;
  lineas: {
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    tipo_iva: number;
    total_linea: number;
  }[];
  // Facturae / Entidad Pública
  es_entidad_publica?: boolean;
  dir3_oficina_contable?: string;
  dir3_organo_gestor?: string;
  dir3_unidad_tramitadora?: string;
  tipo_rectificativa?: string;
  numero_factura_rectificada?: string;
  serie_factura_rectificada?: string;
  cesionario_nif?: string;
  cesionario_nombre?: string;
}

function eurosToCents(value: number): number {
  return Math.round(value * 100);
}

interface InsertFacturaResponse {
  id: number;
  hash_registro: string;
  hash_anterior: string | null;
}

// ─── Estado del envío ─────────────────────────────────────────────────────────

type SubmitPhase =
  | { type: "idle" }
  | { type: "saving" }
  | { type: "generating_xml" }
  | { type: "success"; response: InsertFacturaResponse; xmlGenerated: boolean; xmlPath?: string }
  | { type: "error"; error: ApiError | string };

// ─── Componente de campo con label y error unificados ────────────────────────

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

function FormField({
  label,
  htmlFor,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Panel de totales ────────────────────────────────────────────────────────

interface TotalsPanelProps {
  lineas: InvoiceFormValues["lineas"];
  phase: SubmitPhase;
  onSaveDraft: () => void;
  onSaveAndGenerate: () => void;
  isSubmitting: boolean;
  esEntidadPublica: boolean;
}

function TotalsPanel({
  lineas,
  phase,
  onSaveDraft,
  onSaveAndGenerate,
  isSubmitting,
  esEntidadPublica,
}: TotalsPanelProps) {
  const totals = useInvoiceTotals(lineas);

  return (
    <div className="flex flex-col gap-4">
      {/* Desglose de totales */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Resumen de importes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm">
          {/* Subtotal */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Base imponible</span>
            <span className="tabular-nums font-medium">
              {formatCurrency(totals.subtotal)}
            </span>
          </div>

          {/* Desglose IVA por tipo */}
          {totals.ivaGroups.length === 0 ? (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>IVA (0%)</span>
              <span className="tabular-nums">{formatCurrency(0)}</span>
            </div>
          ) : (
            totals.ivaGroups.map((g) => (
              <div key={g.rate} className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  IVA {g.rate}%
                  <span className="ml-1 text-[11px] text-muted-foreground/60">
                    (base {formatCurrency(g.base)})
                  </span>
                </span>
                <span className="tabular-nums font-medium text-foreground">
                  +{formatCurrency(g.cuota)}
                </span>
              </div>
            ))
          )}

          {/* Retenciones */}
          {totals.totalRetenciones > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Retenciones IRPF</span>
              <span className="tabular-nums font-medium text-rose-600 dark:text-rose-400">
                −{formatCurrency(totals.totalRetenciones)}
              </span>
            </div>
          )}

          <Separator />

          {/* Total */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">Total factura</span>
            <span className="text-lg font-bold tabular-nums text-foreground">
              {formatCurrency(totals.total)}
            </span>
          </div>

          {/* Nota informativa sobre cálculo */}
          <div className="flex items-start gap-1.5 rounded-lg bg-muted/50 p-2.5 mt-1">
            <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Cálculo visual. Los importes definitivos se validan en Rust antes
              de persistir en la base de datos.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Estado del envío */}
      {phase.type === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">
              {typeof phase.error === "string"
                ? phase.error
                : phase.error.message}
            </p>
            {typeof phase.error !== "string" && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Código: {phase.error.code}
              </p>
            )}
          </div>
        </div>
      )}

      {phase.type === "generating_xml" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Aplicando firma XAdES…
            </p>
            <p className="mt-0.5 text-[11px] text-amber-600/80 dark:text-amber-500">
              Procesando el certificado y firmando el XML Facturae 3.2.x…
            </p>
          </div>
        </div>
      )}

      {phase.type === "success" && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-medium text-emerald-700 dark:text-emerald-400">
              Factura guardada correctamente
            </p>
            <p className="mt-0.5 text-[11px] text-emerald-600/80 dark:text-emerald-500 font-mono break-all">
              Hash: {phase.response.hash_registro.slice(0, 24)}…
            </p>
            {phase.xmlGenerated && (
              <>
                <p className="mt-1 text-[11px] text-emerald-600/80 dark:text-emerald-500">
                  ✓ XML Facturae 3.2.x firmado (AutoFirma batch)
                </p>
                {phase.xmlPath && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600/80 dark:text-emerald-500 break-all">
                    <FolderOpen className="size-3 shrink-0" />
                    {phase.xmlPath}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Botones de acción */}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          disabled={isSubmitting}
          onClick={onSaveDraft}
        >
          {phase.type === "saving" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {phase.type === "saving" ? "Guardando…" : "Guardar borrador"}
        </Button>

        <Button
          type="button"
          className="w-full gap-2 bg-gradient-to-r from-primary to-primary/80"
          disabled={isSubmitting}
          onClick={onSaveAndGenerate}
        >
          {phase.type === "generating_xml" || phase.type === "saving" && isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : esEntidadPublica ? (
            <FileCode2 className="size-4" />
          ) : (
            <Save className="size-4" />
          )}
          {phase.type === "generating_xml"
            ? "Aplicando firma XAdES…"
            : esEntidadPublica
            ? "Guardar y Firmar"
            : "Guardar y Emitir"}
        </Button>
      </div>

      {/* Badge VeriFactu */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <FileText className="size-3.5" />
        <span>Hash encadenado VeriFactu incluido</span>
      </div>
    </div>
  );
}

// ─── Cabecera de la tabla de líneas ───────────────────────────────────────────

function LinesTableHeader() {
  return (
    <div className="grid grid-cols-[20px_1fr_80px_100px_110px_110px_100px_36px] gap-2 px-1 pb-1">
      <div />
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Descripción
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">
        Cant.
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">
        P. unitario
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        IVA
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Retención
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">
        Total línea
      </span>
      <div />
    </div>
  );
}

// ─── InvoiceForm ──────────────────────────────────────────────────────────────

export function InvoiceForm() {
  const empresa = useSessionStore(selectEmpresa);
  const navigate = useNavigate();
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>({ type: "idle" });

  // ── Estado del dialog de firma XAdES (almacén del sistema) ──────────
  type SignUIPhase = "confirm" | "signing" | "success" | "error";
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [signUIPhase, setSignUIPhase] = useState<SignUIPhase>("confirm");
  const [signXmlPath, setSignXmlPath] = useState("");
  const [signError, setSignError] = useState("");
  const [pendingFormData, setPendingFormData] = useState<InvoiceFormValues | null>(null);

  // ── Datos reales desde el backend ────────────────────────────────────
  const { data: clientes = [] } = useTauriQuery<ClienteRow[]>(
    ["clientes", empresa?.id],
    "obtener_clientes",
    empresa ? { empresaId: empresa.id } : undefined,
    { enabled: !!empresa }
  );
  const { data: series = [] } = useTauriQuery<SerieRow[]>(
    ["series", empresa?.id],
    "obtener_series",
    empresa ? { empresaId: empresa.id } : undefined,
    { enabled: !!empresa }
  );

  const methods = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: defaultInvoiceFormValues,
    mode: "onBlur",
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = methods;

  const watchedLineas = watch("lineas");
  const watchedSerieId = watch("serie_id");
  const esEntidadPublica = watch("es_entidad_publica");
  const tipoRectificativa = watch("tipo_rectificativa");

  const { fields, append, remove } = useFieldArray({
    control,
    name: "lineas",
  });

  // ── Lógica de envío ──────────────────────────────────────────────────────

  const totals = useInvoiceTotals(watchedLineas ?? []);

  async function submitInvoice(
    data: InvoiceFormValues,
    estado: "BORRADOR" | "EMITIDA"
  ) {
    if (!empresa) {
      setSubmitPhase({
        type: "error",
        error: "No hay empresa seleccionada en la sesión.",
      });
      return;
    }

    setSubmitPhase({ type: "saving" });

    const payload: InsertFacturaInput = {
      empresa_id: empresa.id,
      cliente_id: data.cliente_id,
      serie_id: data.serie_id,
      numero: data.numero,
      fecha_emision: data.fecha_emision,
      subtotal: eurosToCents(totals.subtotal),
      total_impuestos: eurosToCents(totals.totalIva),
      total: eurosToCents(totals.total),
      estado,
      firma_app: null,
      lineas: data.lineas.map((line) => ({
        descripcion: line.descripcion.trim(),
        cantidad: Number(line.cantidad),
        precio_unitario: eurosToCents(Number(line.precio_unitario)),
        tipo_iva: Number(line.tipo_iva),
        total_linea: eurosToCents(calcLine(line).total),
      })),
      // Campos Facturae / Entidad Pública
      es_entidad_publica: data.es_entidad_publica,
      dir3_oficina_contable: data.dir3_oficina_contable || undefined,
      dir3_organo_gestor: data.dir3_organo_gestor || undefined,
      dir3_unidad_tramitadora: data.dir3_unidad_tramitadora || undefined,
      tipo_rectificativa: data.tipo_rectificativa || undefined,
      numero_factura_rectificada: data.numero_factura_rectificada || undefined,
      serie_factura_rectificada: data.serie_factura_rectificada || undefined,
      cesionario_nif: data.cesionario_nif || undefined,
      cesionario_nombre: data.cesionario_nombre || undefined,
    };

    let insertResponse: InsertFacturaResponse;

    try {
      insertResponse = await api.insertarFactura(payload);
    } catch (err) {
      setSubmitPhase({ type: "error", error: err as ApiError | string });
      // Si el dialog de firma está abierto, refleja el error dentro de él
      if (estado === "EMITIDA" && data.es_entidad_publica) {
        const msg =
          typeof err === "string"
            ? err
            : (err as ApiError)?.message ?? "Error al guardar la factura";
        setSignError(msg);
        setSignUIPhase("error");
      }
      return;
    }

    // Genera Facturae XML + firma XAdES si es entidad pública
    if (estado === "EMITIDA" && data.es_entidad_publica) {
      setSubmitPhase({ type: "generating_xml" });
      setSignUIPhase("signing");
      try {
        const xmlPath = await api.firmarFacturaSilenciosa(
          insertResponse.id,
          empresa.id
        );
        setSignXmlPath(xmlPath);
        setSignUIPhase("success");
        setSubmitPhase({
          type: "success",
          response: insertResponse,
          xmlGenerated: true,
          xmlPath,
        });
        queryClient.invalidateQueries({ queryKey: ["facturas"] });
      } catch (err) {
        const msg =
          typeof err === "string"
            ? err
            : (err as ApiError)?.message ?? "Error al firmar la factura";
        setSignError(msg);
        setSignUIPhase("error");
        setSubmitPhase({ type: "error", error: err as ApiError | string });
      }
    } else {
      queryClient.invalidateQueries({ queryKey: ["facturas"] });
      setSubmitPhase({
        type: "success",
        response: insertResponse,
        xmlGenerated: false,
      });
      // Redirige a la lista de facturas tras 1.5 s
      setTimeout(() => navigate("/facturas"), 1500);
    }
  }

  // Autocompletar número siguiente al seleccionar serie
  const handleSerieChange = (serieId: string) => {
    const id = Number(serieId);
    setValue("serie_id", id);
    const serie = series.find((s) => s.id === id);
    if (serie) setValue("numero", serie.siguiente_numero);
  };

  const isSubmitting =
    submitPhase.type === "saving" || submitPhase.type === "generating_xml";

  const onSaveDraft = handleSubmit((data) => submitInvoice(data, "BORRADOR"));
  const onSaveAndGenerate = handleSubmit((data) => {
    if (data.es_entidad_publica) {
      // Entidad pública → abre modal de confirmación; el selector de
      // certificados del SO se mostrará al pulsar "Iniciar firma"
      setPendingFormData(data);
      setSignError("");
      setSignXmlPath("");
      setSignUIPhase("confirm");
      setSignDialogOpen(true);
    } else {
      submitInvoice(data, "EMITIDA");
    }
  });

  async function handleStartSign() {
    if (!pendingFormData) return;
    await submitInvoice(pendingFormData, "EMITIDA");
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <FormProvider {...methods}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        {/* ── Columna principal ──────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* Card 1: Encabezado */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="size-3.5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">
                    Datos de la factura
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Información de cabecera requerida
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Selector tipo de destinatario */}
              <div className="mb-5">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Tipo de destinatario
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setValue("es_entidad_publica", false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      !esEntidadPublica
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    )}
                  >
                    <Building2
                      className={cn(
                        "size-4 shrink-0",
                        !esEntidadPublica
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    />
                    <div>
                      <p className="font-medium leading-tight">Empresa / Particular</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                        Factura ordinaria
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setValue("es_entidad_publica", true)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      esEntidadPublica
                        ? "border-amber-500 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                        : "border-border bg-background text-muted-foreground hover:border-amber-400/40 hover:text-foreground"
                    )}
                  >
                    <Landmark
                      className={cn(
                        "size-4 shrink-0",
                        esEntidadPublica
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                      )}
                    />
                    <div>
                      <p className="font-medium leading-tight">Entidad pública</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                        Requiere Facturae + firma
                      </p>
                    </div>
                  </button>
                </div>

                {esEntidadPublica && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Al guardar se generará un XML Facturae 3.2.x firmado con tu
                      certificado digital (.p12/.pfx). La contraseña{" "}
                      <strong>no se almacena</strong> en ningún momento.
                    </span>
                  </div>
                )}
              </div>

              {/* ─── Códigos DIR3 (solo entidad pública) ─── */}
              {esEntidadPublica && (
                <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <div className="mb-3 flex items-center gap-2">
                    <Landmark className="size-3.5 text-amber-600 dark:text-amber-400" />
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      Códigos DIR3
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <FormField
                      label="Oficina contable"
                      htmlFor="dir3_oficina_contable"
                      error={errors.dir3_oficina_contable?.message}
                      required
                    >
                      <Input
                        id="dir3_oficina_contable"
                        placeholder="E.g. L01280796"
                        {...register("dir3_oficina_contable")}
                        className={cn(errors.dir3_oficina_contable && "border-destructive")}
                      />
                    </FormField>
                    <FormField
                      label="Órgano gestor"
                      htmlFor="dir3_organo_gestor"
                      error={errors.dir3_organo_gestor?.message}
                      required
                    >
                      <Input
                        id="dir3_organo_gestor"
                        placeholder="E.g. L01280796"
                        {...register("dir3_organo_gestor")}
                        className={cn(errors.dir3_organo_gestor && "border-destructive")}
                      />
                    </FormField>
                    <FormField
                      label="Unidad tramitadora"
                      htmlFor="dir3_unidad_tramitadora"
                      error={errors.dir3_unidad_tramitadora?.message}
                    >
                      <Input
                        id="dir3_unidad_tramitadora"
                        placeholder="Opcional"
                        {...register("dir3_unidad_tramitadora")}
                        className={cn(errors.dir3_unidad_tramitadora && "border-destructive")}
                      />
                    </FormField>
                  </div>
                </div>
              )}

              {/* ─── Factura rectificativa ─── */}
              <div className="mb-5">
                <details className="group">
                  <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <GitBranch className="size-3.5" />
                    <span>Factura rectificativa (opcional)</span>
                  </summary>
                  <div className="mt-3 rounded-lg border border-dashed border-border p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <FormField
                        label="Tipo de rectificación"
                        htmlFor="tipo_rectificativa"
                        error={errors.tipo_rectificativa?.message}
                        className="sm:col-span-1"
                      >
                        <Controller
                          control={control}
                          name="tipo_rectificativa"
                          render={({ field }) => (
                            <Select
                              value={field.value || "__none__"}
                              onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                            >
                              <SelectTrigger
                                id="tipo_rectificativa"
                                className={cn(errors.tipo_rectificativa && "border-destructive")}
                              >
                                <SelectValue placeholder="Sin rectificación" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Sin rectificación</SelectItem>
                                {TIPOS_RECTIFICATIVA.map((t) => (
                                  <SelectItem key={t.value} value={t.value}>
                                    {t.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormField>

                      {tipoRectificativa && (
                        <>
                          <FormField
                            label="Nº factura rectificada"
                            htmlFor="numero_factura_rectificada"
                            error={errors.numero_factura_rectificada?.message}
                          >
                            <Input
                              id="numero_factura_rectificada"
                              placeholder="E.g. A-2024-001"
                              {...register("numero_factura_rectificada")}
                              className={cn(errors.numero_factura_rectificada && "border-destructive")}
                            />
                          </FormField>
                          <FormField
                            label="Serie factura rectificada"
                            htmlFor="serie_factura_rectificada"
                            error={errors.serie_factura_rectificada?.message}
                          >
                            <Input
                              id="serie_factura_rectificada"
                              placeholder="E.g. A"
                              {...register("serie_factura_rectificada")}
                              className={cn(errors.serie_factura_rectificada && "border-destructive")}
                            />
                          </FormField>
                        </>
                      )}
                    </div>
                  </div>
                </details>
              </div>

              {/* ─── Cesionario ─── */}
              <div className="mb-5">
                <details className="group">
                  <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <UserCheck className="size-3.5" />
                    <span>Cesionario / Factor de cobro (opcional)</span>
                  </summary>
                  <div className="mt-3 rounded-lg border border-dashed border-border p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField
                        label="NIF del cesionario"
                        htmlFor="cesionario_nif"
                        error={errors.cesionario_nif?.message}
                      >
                        <Input
                          id="cesionario_nif"
                          placeholder="NIF / Prefijo país + NIF"
                          {...register("cesionario_nif")}
                          className={cn(errors.cesionario_nif && "border-destructive")}
                        />
                      </FormField>
                      <FormField
                        label="Nombre del cesionario"
                        htmlFor="cesionario_nombre"
                        error={errors.cesionario_nombre?.message}
                      >
                        <Input
                          id="cesionario_nombre"
                          placeholder="Razón social o nombre completo"
                          {...register("cesionario_nombre")}
                          className={cn(errors.cesionario_nombre && "border-destructive")}
                        />
                      </FormField>
                    </div>
                  </div>
                </details>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Cliente */}
                <FormField
                  label="Cliente"
                  htmlFor="cliente_id"
                  error={errors.cliente_id?.message}
                  required
                  className="sm:col-span-2"
                >
                  <Controller
                    control={control}
                    name="cliente_id"
                    render={({ field }) => (
                      <Select
                        value={field.value > 0 ? String(field.value) : ""}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <SelectTrigger
                          id="cliente_id"
                          className={cn(
                            "h-10",
                            errors.cliente_id && "border-destructive"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <User className="size-3.5 text-muted-foreground shrink-0" />
                            <SelectValue placeholder="Selecciona un cliente…" />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {clientes.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                              No hay clientes. Añade uno desde la sección Clientes.
                            </div>
                          ) : (
                            clientes.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                <span className="font-medium">{c.nombre}</span>
                                {c.nif && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {c.nif}
                                  </span>
                                )}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>

                {/* Serie */}
                <FormField
                  label="Serie de facturación"
                  htmlFor="serie_id"
                  error={errors.serie_id?.message}
                  required
                >
                  <Controller
                    control={control}
                    name="serie_id"
                    render={({ field }) => (
                      <Select
                        value={field.value > 0 ? String(field.value) : ""}
                        onValueChange={handleSerieChange}
                      >
                        <SelectTrigger
                          id="serie_id"
                          className={cn(errors.serie_id && "border-destructive")}
                        >
                          <SelectValue placeholder="Selecciona serie…" />
                        </SelectTrigger>
                        <SelectContent>
                          {series.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                              No hay series. Configura una desde Mi empresa.
                            </div>
                          ) : (
                            series.map((s) => (
                              <SelectItem key={s.id} value={String(s.id)}>
                                <span className="font-medium">{s.nombre}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({s.prefijo})
                                </span>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>

                {/* Número */}
                <FormField
                  label="Número"
                  htmlFor="numero"
                  error={errors.numero?.message}
                  required
                >
                  <div className="relative">
                    <Hash className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      id="numero"
                      type="number"
                      min="1"
                      step="1"
                      {...register("numero")}
                      className={cn(
                        "pl-8 tabular-nums",
                        errors.numero && "border-destructive focus-visible:ring-destructive"
                      )}
                    />
                  </div>
                  {watchedSerieId > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Número sugerido según la serie seleccionada
                    </p>
                  )}
                </FormField>

                {/* Fecha de emisión */}
                <FormField
                  label="Fecha de emisión"
                  htmlFor="fecha_emision"
                  error={errors.fecha_emision?.message}
                  required
                >
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      id="fecha_emision"
                      type="date"
                      {...register("fecha_emision")}
                      className={cn(
                        "pl-8",
                        errors.fecha_emision &&
                          "border-destructive focus-visible:ring-destructive"
                      )}
                    />
                  </div>
                </FormField>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Líneas de factura */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                    <FileCode2 className="size-3.5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      Conceptos facturados
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {fields.length}{" "}
                      {fields.length === 1 ? "línea" : "líneas"}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs shrink-0"
                  onClick={() => append({ ...defaultInvoiceLine })}
                >
                  <Plus className="size-3.5" />
                  Añadir línea
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/* Error general de líneas */}
              {errors.lineas?.root?.message && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" />
                  {errors.lineas.root.message}
                </div>
              )}

              {/* Cabecera de tabla */}
              <div className="hidden md:block">
                <LinesTableHeader />
                <Separator className="mb-1" />
              </div>

              {/* Filas dinámicas */}
              <div className="flex flex-col">
                {fields.map((field, index) => (
                  <InvoiceLineRow
                    key={field.id}
                    index={index}
                    canDelete={fields.length > 1}
                    onDelete={() => remove(index)}
                  />
                ))}
              </div>

              {/* Botón añadir (al pie) */}
              <div className="mt-3 flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => append({ ...defaultInvoiceLine })}
                >
                  <Plus className="size-3.5" />
                  Añadir otro concepto
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Notas */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-muted">
                  <StickyNote className="size-3.5 text-muted-foreground" />
                </div>
                <CardTitle className="text-sm font-semibold">
                  Notas y observaciones{" "}
                  <Badge variant="secondary" className="ml-1 text-[10px]">
                    Opcional
                  </Badge>
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <FormField
                label="Texto libre para el pie de factura"
                htmlFor="notas"
                error={errors.notas?.message}
              >
                <Textarea
                  id="notas"
                  {...register("notas")}
                  placeholder="Condiciones de pago, datos bancarios, agradecimientos…"
                  className="min-h-[90px] text-sm"
                />
              </FormField>
            </CardContent>
          </Card>
        </div>

        {/* ── Columna lateral con totales (sticky) ──────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <TotalsPanel
            lineas={watchedLineas ?? []}
            phase={submitPhase}
            onSaveDraft={onSaveDraft}
            onSaveAndGenerate={onSaveAndGenerate}
            isSubmitting={isSubmitting}
            esEntidadPublica={esEntidadPublica}
          />
        </div>
      </div>
      {/* ── Dialog de firma XAdES (almacén del sistema) ──────────────── */}
      <Dialog
        open={signDialogOpen}
        onOpenChange={(open) => {
          if (
            !open &&
            (signUIPhase === "confirm" ||
              signUIPhase === "success" ||
              signUIPhase === "error")
          ) {
            setSignDialogOpen(false);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(e) => {
            if (signUIPhase === "signing") e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (signUIPhase === "signing") e.preventDefault();
          }}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg",
                  signUIPhase === "success"
                    ? "bg-emerald-100 dark:bg-emerald-950/50"
                    : signUIPhase === "error"
                    ? "bg-destructive/10"
                    : "bg-primary/10"
                )}
              >
                {signUIPhase === "success" ? (
                  <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                ) : signUIPhase === "error" ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : signUIPhase === "signing" ? (
                  <Loader2 className="size-4 text-primary animate-spin" />
                ) : (
                  <PenLine className="size-4 text-primary" />
                )}
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold">
                  {signUIPhase === "success"
                    ? "Factura firmada correctamente"
                    : signUIPhase === "error"
                    ? "Error al firmar la factura"
                    : signUIPhase === "signing"
                    ? "Firmando con certificado del sistema…"
                    : "Firmar con certificado digital"}
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {signUIPhase === "confirm" &&
                    "Se usará el almacén de certificados instalados en Windows."}
                  {signUIPhase === "signing" &&
                    "Guardando factura y aplicando firma XAdES-EPES…"}
                  {signUIPhase === "success" &&
                    "El XML Facturae 3.2.x ha sido firmado y guardado."}
                  {signUIPhase === "error" &&
                    "Comprueba que el certificado y el dispositivo están disponibles."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            {/* Fase: confirmar */}
            {signUIPhase === "confirm" && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-3 text-xs text-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="flex flex-col gap-1">
                    <p className="font-medium">
                      Se abrirá el selector de certificados de Windows
                    </p>
                    <p className="text-muted-foreground leading-relaxed">
                      Selecciona tu certificado digital (DNIe, FNMT, tarjeta
                      corporativa…) en el diálogo del sistema operativo y confirma.
                      La firma se aplicará automáticamente.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
                  <AlertCircle className="mt-0.5 size-3 shrink-0" />
                  <span>
                    Asegúrate de que el dispositivo (tarjeta inteligente, DNIe,
                    token USB) está conectado antes de continuar.
                  </span>
                </div>
              </div>
            )}

            {/* Fase: firmando */}
            {signUIPhase === "signing" && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                <span>
                  El selector de certificados de Windows se abrirá en breve.
                  Selecciona tu certificado y acepta para continuar.
                </span>
              </div>
            )}

            {/* Fase: éxito */}
            {signUIPhase === "success" && (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  <span className="font-medium">
                    Firma XAdES-EPES aplicada correctamente
                  </span>
                </div>
                {signXmlPath && (
                  <div className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
                    <FolderOpen className="mt-0.5 size-3 shrink-0" />
                    <span className="break-all font-mono">{signXmlPath}</span>
                  </div>
                )}
              </>
            )}

            {/* Fase: error */}
            {signUIPhase === "error" && signError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span className="break-words">{signError}</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {signUIPhase === "confirm" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSignDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleStartSign}
                >
                  <PenLine className="size-3.5" />
                  Iniciar firma
                </Button>
              </>
            )}
            {(signUIPhase === "success" || signUIPhase === "error") && (
              <Button
                type="button"
                size="sm"
                variant={signUIPhase === "error" ? "outline" : "default"}
                className="gap-1.5"
                onClick={() => {
                  setSignDialogOpen(false);
                  if (signUIPhase === "success") navigate("/facturas");
                }}
              >
                {signUIPhase === "success" ? (
                  <>
                    <CheckCircle2 className="size-3.5" />
                    Ver facturas
                  </>
                ) : (
                  "Cerrar"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormProvider>
  );
}
