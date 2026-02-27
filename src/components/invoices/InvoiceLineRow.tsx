import React from "react";
import { useFormContext, Controller } from "react-hook-form";
import { Trash2, GripVertical } from "lucide-react";
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
import { calcLine } from "@/hooks/useInvoiceTotals";
import { IVA_RATES, RETENCION_RATES } from "@/lib/schemas/invoiceSchema";
import type { InvoiceFormValues } from "@/lib/schemas/invoiceSchema";

// ─── Props ────────────────────────────────────────────────────────────────────

interface InvoiceLineRowProps {
  index: number;
  canDelete: boolean;
  onDelete: () => void;
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

// ─── Fila de línea de factura ─────────────────────────────────────────────────

export function InvoiceLineRow({ index, canDelete, onDelete }: InvoiceLineRowProps) {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext<InvoiceFormValues>();

  const lineErrors = errors.lineas?.[index];
  const lineValues = watch(`lineas.${index}`);
  const totals = calcLine(lineValues);

  return (
    <div className="group relative grid grid-cols-[20px_1fr_80px_100px_110px_110px_100px_36px] items-start gap-2 rounded-lg border border-transparent px-1 py-2 transition-colors hover:border-border hover:bg-muted/20">
      {/* Handle visual (sin DnD por ahora) */}
      <div className="flex h-10 items-center justify-center cursor-grab opacity-0 group-hover:opacity-40 transition-opacity">
        <GripVertical className="size-3.5 text-muted-foreground" />
      </div>

      {/* Descripción */}
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

      {/* Retención */}
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
