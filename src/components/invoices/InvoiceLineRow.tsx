import React, { useState, useMemo } from "react";
import { useFormContext, Controller } from "react-hook-form";
import { Trash2, GripVertical, PackageSearch } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { calcLine } from "@/hooks/useInvoiceTotals";
import { IVA_RATES, RETENCION_RATES } from "@/lib/schemas/invoiceSchema";
import type { InvoiceFormValues } from "@/lib/schemas/invoiceSchema";
import type { ProductoRow } from "@/lib/api";

// ─── Props ────────────────────────────────────────────────────────────────────

interface InvoiceLineRowProps {
  index: number;
  canDelete: boolean;
  onDelete: () => void;
  esAutonomo: boolean;
  productos?: ProductoRow[];
}

// ─── Celda de campo con mensaje de error inline ──────────────────────────────

interface FieldCellProps {
  error?: string;
  className?: string;
  children: React.ReactNode;
}

function FieldCell({ error, className, children }: FieldCellProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {children}
      {error && (
        <span className="text-[10px] font-medium text-destructive leading-none mt-0.5">
          {error}
        </span>
      )}
    </div>
  );
}

// ─── Selector de producto del catálogo ───────────────────────────────────────

interface ProductSelectorProps {
  productos: ProductoRow[];
  onSelect: (p: ProductoRow) => void;
}

function ProductSelector({ productos, onSelect }: ProductSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return productos;
    return productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        (p.descripcion ?? "").toLowerCase().includes(q) ||
        (p.referencia ?? "").toLowerCase().includes(q)
    );
  }, [productos, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
          title="Seleccionar del cat\u00e1logo de productos/servicios"
        >
          <PackageSearch className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* B\u00fasqueda */}
        <div className="border-b px-3 py-2">
          <Input
            autoFocus
            placeholder="Buscar producto o servicio\u2026"
            className="h-8 text-sm border-none shadow-none focus-visible:ring-0 px-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Lista */}
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {productos.length === 0
                ? "No hay productos en el cat\u00e1logo."
                : "Sin resultados para tu b\u00fasqueda."}
            </p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => {
                  onSelect(p);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <span className="text-sm font-medium leading-tight truncate">
                  {p.nombre}
                </span>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">
                    {formatCurrency(p.precio_unitario / 100)}
                  </span>
                  <span>\u00b7</span>
                  <span>IVA {p.tipo_iva}%</span>
                  {p.referencia && (
                    <>
                      <span>\u00b7</span>
                      <span className="truncate">{p.referencia}</span>
                    </>
                  )}
                </span>
                {p.descripcion && (
                  <span className="text-[11px] text-muted-foreground truncate">
                    {p.descripcion}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Fila de l\u00ednea de factura ─────────────────────────────────────────────────

export function InvoiceLineRow({ index, canDelete, onDelete, esAutonomo, productos = [] }: InvoiceLineRowProps) {
  const {
    register,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<InvoiceFormValues>();

  const lineErrors = errors.lineas?.[index];
  const lineValues = watch(`lineas.${index}`);
  const totals = calcLine(lineValues);

  // precio_unitario en DB est\u00e1 en c\u00e9ntimos \u2192 convertir a euros para el form
  function handleProductSelect(p: ProductoRow) {
    const desc = p.descripcion?.trim() || p.nombre;
    setValue(`lineas.${index}.descripcion`, desc, { shouldValidate: true });
    setValue(`lineas.${index}.precio_unitario`, p.precio_unitario / 100, { shouldValidate: true });
    setValue(`lineas.${index}.tipo_iva`, p.tipo_iva, { shouldValidate: true });
  }

  return (
    <div
      className={cn(
        "group relative grid items-start gap-2 rounded-lg border border-transparent px-1 py-2 transition-colors hover:border-border hover:bg-muted/20",
        esAutonomo
          ? "grid-cols-[20px_36px_1fr_80px_100px_110px_110px_100px_36px]"
          : "grid-cols-[20px_36px_1fr_80px_100px_110px_100px_36px]"
      )}
    >
      {/* Handle visual (sin DnD por ahora) */}
      <div className="flex h-10 items-center justify-center cursor-grab opacity-0 group-hover:opacity-40 transition-opacity">
        <GripVertical className="size-3.5 text-muted-foreground" />
      </div>

      {/* Bot\u00f3n cat\u00e1logo de productos */}
      <div className="flex h-10 items-center">
        <ProductSelector productos={productos} onSelect={handleProductSelect} />
      </div>

      {/* Descripci\u00f3n */}
      <FieldCell error={lineErrors?.descripcion?.message}>
        <Input
          {...register(`lineas.${index}.descripcion`)}
          placeholder="Descripción del concepto…"
          className={cn(
            "h-10 text-sm",
            lineErrors?.descripcion && "border-destructive focus-visible:ring-destructive"
          )}
        />
      </FieldCell>

      {/* Cantidad */}
      <FieldCell error={lineErrors?.cantidad?.message}>
        <Input
          {...register(`lineas.${index}.cantidad`)}
          type="number"
          step="0.01"
          min="0.01"
          placeholder="1"
          className={cn(
            "h-10 text-sm text-right tabular-nums",
            lineErrors?.cantidad && "border-destructive focus-visible:ring-destructive"
          )}
        />
      </FieldCell>

      {/* Precio unitario */}
      <FieldCell error={lineErrors?.precio_unitario?.message}>
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            €
          </span>
          <Input
            {...register(`lineas.${index}.precio_unitario`)}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className={cn(
              "h-10 pl-6 text-sm text-right tabular-nums",
              lineErrors?.precio_unitario &&
                "border-destructive focus-visible:ring-destructive"
            )}
          />
        </div>
      </FieldCell>

      {/* IVA */}
      <FieldCell error={lineErrors?.tipo_iva?.message}>
        <Controller
          control={control}
          name={`lineas.${index}.tipo_iva`}
          render={({ field }) => (
            <Select
              value={String(field.value)}
              onValueChange={(v) => field.onChange(Number(v))}
            >
              <SelectTrigger
                className={cn(
                  "h-10 text-sm",
                  lineErrors?.tipo_iva && "border-destructive"
                )}
              >
                <SelectValue placeholder="IVA" />
              </SelectTrigger>
              <SelectContent>
                {IVA_RATES.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FieldCell>

      {/* Retención (solo autónomo) */}
      {esAutonomo && (
      <FieldCell error={lineErrors?.tipo_retencion?.message}>
        <Controller
          control={control}
          name={`lineas.${index}.tipo_retencion`}
          render={({ field }) => (
            <Select
              value={String(field.value)}
              onValueChange={(v) => field.onChange(Number(v))}
            >
              <SelectTrigger
                className={cn(
                  "h-10 text-sm",
                  lineErrors?.tipo_retencion && "border-destructive"
                )}
              >
                <SelectValue placeholder="Ret." />
              </SelectTrigger>
              <SelectContent>
                {RETENCION_RATES.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FieldCell>
      )}

      {/* Total línea (calculado) */}
      <div className="flex h-10 items-center justify-end">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            totals.total === 0
              ? "text-muted-foreground"
              : "text-foreground"
          )}
        >
          {formatCurrency(totals.total)}
        </span>
      </div>

      {/* Eliminar */}
      <div className="flex h-10 items-center justify-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!canDelete}
          onClick={onDelete}
          className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-20"
          aria-label="Eliminar línea"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
