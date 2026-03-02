import { z } from "zod";

// ─── Tipos IVA y Retención disponibles en España ──────────────────────────────

export const IVA_RATES = [
  { label: "21% (General)", value: 21 },
  { label: "10% (Reducido)", value: 10 },
  { label: "4% (Superreducido)", value: 4 },
  { label: "0% (Exento)", value: 0 },
] as const;

export const RETENCION_RATES = [
  { label: "Sin retención (0%)", value: 0 },
  { label: "7% (nuevos autónomos)", value: 7 },
  { label: "15% (IRPF profesional)", value: 15 },
  { label: "19% (capital mobiliario)", value: 19 },
] as const;

export type IvaRate = (typeof IVA_RATES)[number]["value"];
export type RetencionRate = (typeof RETENCION_RATES)[number]["value"];

// ─── Schema de una línea de factura ──────────────────────────────────────────

export const invoiceLineSchema = z.object({
  descripcion: z
    .string()
    .trim()
    .min(1, "La descripción es obligatoria")
    .max(500, "Máximo 500 caracteres"),
  cantidad: z.coerce
    .number({ invalid_type_error: "Introduce un número" })
    .positive("La cantidad debe ser positiva")
    .max(99_999, "Cantidad demasiado grande"),
  precio_unitario: z.coerce
    .number({ invalid_type_error: "Introduce un número" })
    .nonnegative("El precio no puede ser negativo")
    .max(999_999.99, "Precio demasiado elevado"),
  tipo_iva: z.coerce
    .number()
    .refine(
      (v) => IVA_RATES.map((r) => r.value).includes(v as IvaRate),
      "Tipo de IVA no válido"
    ),
  tipo_retencion: z.coerce
    .number()
    .refine(
      (v) => RETENCION_RATES.map((r) => r.value).includes(v as RetencionRate),
      "Tipo de retención no válido"
    ),
});

export type InvoiceLineValues = z.infer<typeof invoiceLineSchema>;

// ─── Schema principal de la factura ──────────────────────────────────────────

// Tipos de factura rectificativa según Order HAP/1650/2015 Anexo II
// ─── Métodos de pago ────────────────────────────────────────────────────────

export const METODOS_PAGO = [
  { label: "Transferencia bancaria", value: "transferencia" },
  { label: "Efectivo", value: "efectivo" },
  { label: "Tarjeta", value: "tarjeta" },
  { label: "Recibo domiciliado", value: "recibo_domiciliado" },
] as const;

export type MetodoPago = (typeof METODOS_PAGO)[number]["value"];

export const TIPOS_RECTIFICATIVA = [
  { label: "01 – Sustitución (anula y reemplaza)", value: "01" },
  { label: "02 – Anulación pura", value: "02" },
  { label: "03 – Descuento / bonificación", value: "03" },
  { label: "04 – Autorización AEAT", value: "04" },
] as const;

export type TipoRectificativa = (typeof TIPOS_RECTIFICATIVA)[number]["value"];

export const invoiceFormSchema = z.object({
  cliente_id: z.coerce
    .number({ invalid_type_error: "Selecciona un cliente" })
    .positive("Selecciona un cliente"),
  serie_id: z.coerce
    .number({ invalid_type_error: "Selecciona una serie" })
    .positive("Selecciona una serie"),
  numero: z.coerce
    .number({ invalid_type_error: "Introduce el número" })
    .int("Debe ser un número entero")
    .positive("El número debe ser mayor que cero"),
  fecha_emision: z
    .string()
    .min(1, "La fecha de emisión es obligatoria")
    .refine(
      (d) => !isNaN(Date.parse(d)),
      "Formato de fecha no válido"
    )
    .refine(
      (d) => {
        // Comparamos objetos Date reales para evitar fallos en casos límite
        // (zonas horarias, strings no estrictamente ISO, etc.)
        const input = new Date(d + "T00:00:00");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return input <= today;
      },
      "La fecha de emisión no puede ser posterior a hoy"
    ),
  notas: z.string().max(1000, "Máximo 1000 caracteres").optional(),

  // ─── Condiciones de pago ─────────────────────────────────────────────────
  fecha_vencimiento: z
    .string()
    .optional()
    .refine(
      (d) => !d || !isNaN(Date.parse(d)),
      "Formato de fecha no válido"
    )
    .or(z.literal("")),
  metodo_pago: z
    .string()
    .optional()
    .refine(
      (v) => !v || METODOS_PAGO.map((m) => m.value).includes(v as MetodoPago),
      "Método de pago no válido"
    )
    .or(z.literal("")),
  cuenta_bancaria: z
    .string()
    .trim()
    .max(34, "Máximo 34 caracteres (IBAN)")
    .optional()
    .or(z.literal("")),

  lineas: z
    .array(invoiceLineSchema)
    .min(1, "La factura debe tener al menos una línea"),

  // ─── Campos Entidad Pública / Facturae ───────────────────────────────────
  es_entidad_publica: z.boolean().default(false),

  // Códigos DIR3 obligatorios cuando es_entidad_publica = true
  dir3_oficina_contable: z
    .string()
    .trim()
    .max(20, "Máximo 20 caracteres")
    .optional()
    .or(z.literal("")),
  dir3_organo_gestor: z
    .string()
    .trim()
    .max(20, "Máximo 20 caracteres")
    .optional()
    .or(z.literal("")),
  dir3_unidad_tramitadora: z
    .string()
    .trim()
    .max(20, "Máximo 20 caracteres")
    .optional()
    .or(z.literal("")),

  // Factura rectificativa
  tipo_rectificativa: z
    .string()
    .optional()
    .or(z.literal("")),
  numero_factura_rectificada: z
    .string()
    .trim()
    .max(40, "Máximo 40 caracteres")
    .optional()
    .or(z.literal("")),
  serie_factura_rectificada: z
    .string()
    .trim()
    .max(20, "Máximo 20 caracteres")
    .optional()
    .or(z.literal("")),

  // Cesionario (NIF y nombre, distintos del emisor — validación en backend)
  cesionario_nif: z
    .string()
    .trim()
    .max(20, "Máximo 20 caracteres")
    .optional()
    .or(z.literal("")),
  cesionario_nombre: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres")
    .optional()
    .or(z.literal("")),
})
// Validación cruzada: DIR3 obligatorio si es entidad pública
.superRefine((data, ctx) => {
  if (data.es_entidad_publica) {
    if (!data.dir3_oficina_contable?.trim()) {
      ctx.addIssue({ code: "custom", path: ["dir3_oficina_contable"], message: "Obligatorio para entidades públicas" });
    }
    if (!data.dir3_organo_gestor?.trim()) {
      ctx.addIssue({ code: "custom", path: ["dir3_organo_gestor"], message: "Obligatorio para entidades públicas" });
    }
    if (!data.dir3_unidad_tramitadora?.trim()) {
      ctx.addIssue({ code: "custom", path: ["dir3_unidad_tramitadora"], message: "Obligatorio para entidades públicas" });
    }
  }
  // Rectificativa tipos 01/02 requieren número de factura original
  if ((data.tipo_rectificativa === "01" || data.tipo_rectificativa === "02") &&
      !data.numero_factura_rectificada?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["numero_factura_rectificada"],
      message: "Los tipos 01 y 02 requieren el número de la factura original",
    });
  }
});

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

// ─── Valor predeterminado de una línea vacía ──────────────────────────────────

export const defaultInvoiceLine: InvoiceLineValues = {
  descripcion: "",
  cantidad: 1,
  precio_unitario: 0,
  tipo_iva: 21,
  tipo_retencion: 0,
};

// ─── Valores por defecto del formulario ──────────────────────────────────────

export const defaultInvoiceFormValues: InvoiceFormValues = {
  cliente_id: 0,
  serie_id: 0,
  numero: 1,
  fecha_emision: new Date().toISOString().split("T")[0],
  notas: "",
  fecha_vencimiento: "",
  metodo_pago: "",
  cuenta_bancaria: "",
  lineas: [{ ...defaultInvoiceLine }],
  es_entidad_publica: false,
  dir3_oficina_contable: "",
  dir3_organo_gestor: "",
  dir3_unidad_tramitadora: "",
  tipo_rectificativa: "",
  numero_factura_rectificada: "",
  serie_factura_rectificada: "",
  cesionario_nif: "",
  cesionario_nombre: "",
};
