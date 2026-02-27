import { useMemo } from "react";
import type { InvoiceLineValues } from "@/lib/schemas/invoiceSchema";

// ─── Cálculo de una línea individual ─────────────────────────────────────────

export interface LineTotals {
  base: number;            // cantidad × precio_unitario
  cuota_iva: number;       // base × tipo_iva / 100
  cuota_retencion: number; // base × tipo_retencion / 100
  total: number;           // base + cuota_iva - cuota_retencion
}

export function calcLine(line: InvoiceLineValues): LineTotals {
  const base = Number(line.cantidad) * Number(line.precio_unitario);
  const cuota_iva = base * (Number(line.tipo_iva) / 100);
  const cuota_retencion = base * (Number(line.tipo_retencion) / 100);
  return {
    base: round2(base),
    cuota_iva: round2(cuota_iva),
    cuota_retencion: round2(cuota_retencion),
    total: round2(base + cuota_iva - cuota_retencion),
  };
}

// ─── Resumen de IVA agrupado por tipo ────────────────────────────────────────

export interface IvaGroup {
  rate: number;
  base: number;
  cuota: number;
}

// ─── Totales del formulario completo ─────────────────────────────────────────

export interface InvoiceTotals {
  subtotal: number;           // suma de bases
  ivaGroups: IvaGroup[];      // desglose IVA por tipo
  totalIva: number;           // suma cuotas IVA
  totalRetenciones: number;   // suma retenciones
  total: number;              // subtotal + totalIva - totalRetenciones
}

export function useInvoiceTotals(lineas: InvoiceLineValues[]): InvoiceTotals {
  return useMemo(() => {
    const ivaMap = new Map<number, { base: number; cuota: number }>();

    let subtotal = 0;
    let totalIva = 0;
    let totalRetenciones = 0;

    for (const line of lineas) {
      const t = calcLine(line);
      subtotal += t.base;
      totalIva += t.cuota_iva;
      totalRetenciones += t.cuota_retencion;

      const rate = Number(line.tipo_iva);
      const prev = ivaMap.get(rate) ?? { base: 0, cuota: 0 };
      ivaMap.set(rate, {
        base: prev.base + t.base,
        cuota: prev.cuota + t.cuota_iva,
      });
    }

    const ivaGroups: IvaGroup[] = Array.from(ivaMap.entries())
      .filter(([, v]) => v.cuota > 0 || v.base > 0)
      .map(([rate, v]) => ({
        rate,
        base: round2(v.base),
        cuota: round2(v.cuota),
      }))
      .sort((a, b) => b.rate - a.rate);

    return {
      subtotal: round2(subtotal),
      ivaGroups,
      totalIva: round2(totalIva),
      totalRetenciones: round2(totalRetenciones),
      total: round2(subtotal + totalIva - totalRetenciones),
    };
  }, [lineas]);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
