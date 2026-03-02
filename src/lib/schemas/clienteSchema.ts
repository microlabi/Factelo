import { z } from "zod";

// ─── Constantes ───────────────────────────────────────────────────────────────

export const TIPOS_ENTIDAD = [
  { label: "Empresa (B2B)", value: "Empresa" },
  { label: "Autónomo / Particular (B2C)", value: "Autónomo" },
  { label: "Entidad Pública (B2G)", value: "Entidad_Publica" },
] as const;

export type TipoEntidad = (typeof TIPOS_ENTIDAD)[number]["value"];

export const METODOS_PAGO = [
  { label: "Transferencia bancaria", value: "transferencia" },
  { label: "Domiciliación (SEPA)", value: "domiciliacion" },
  { label: "Tarjeta de crédito", value: "tarjeta" },
  { label: "Efectivo", value: "efectivo" },
  { label: "Cheque", value: "cheque" },
  { label: "Pagaré", value: "pagare" },
] as const;

export const PAISES_ISO = [
  { label: "España", value: "ES" },
  { label: "Portugal", value: "PT" },
  { label: "Francia", value: "FR" },
  { label: "Alemania", value: "DE" },
  { label: "Italia", value: "IT" },
  { label: "Reino Unido", value: "GB" },
  { label: "Estados Unidos", value: "US" },
  { label: "Otro", value: "XX" },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Campo de texto opcional: admite vacío, transforma a undefined si vacío */
const optText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

// ─── Schema base ─────────────────────────────────────────────────────────────

const clienteBaseSchema = z.object({
  empresa_id: z.number().int().positive(),

  // ── Identificación ─────────────────────────────────────────────────────────
  tipo_entidad: z.enum(["Empresa", "Autónomo", "Entidad_Publica"], {
    required_error: "El tipo de entidad es obligatorio",
    invalid_type_error: "Tipo de entidad no válido",
  }),
  nombre: z
    .string()
    .trim()
    .min(1, "La razón social es obligatoria")
    .max(200, "Máximo 200 caracteres"),
  nif: optText,
  nombre_comercial: optText,

  // ── Dirección y contacto ───────────────────────────────────────────────────
  direccion: optText,
  codigo_postal: optText,
  poblacion: optText,
  provincia: optText,
  pais: z.string().trim().min(2, "País obligatorio").default("ES"),
  email: z.union([z.literal(""), z.string().email("Email no válido")]).optional(),
  telefono: optText,
  persona_contacto: optText,

  // ── Preferencias de facturación ────────────────────────────────────────────
  metodo_pago_defecto: optText,
  dias_vencimiento: z.coerce
    .number({ invalid_type_error: "Introduce un número" })
    .int()
    .min(0, "Mínimo 0 días")
    .max(365, "Máximo 365 días")
    .default(30),
  iban_cuenta: optText,

  // ── Fiscalidad ─────────────────────────────────────────────────────────────
  aplica_irpf: z.boolean().default(false),
  aplica_recargo_eq: z.boolean().default(false),
  operacion_intracomunitaria: z.boolean().default(false),

  // ── Códigos DIR3 (opcionales en el schema base) ───────────────────────────
  dir3_oficina_contable: optText,
  dir3_organo_gestor: optText,
  dir3_unidad_tramitadora: optText,
});

// ─── Schema exportado con refinement condicional DIR3 ────────────────────────

export const clienteSchema = clienteBaseSchema.superRefine((data, ctx) => {
  if (data.tipo_entidad === "Entidad_Publica") {
    if (!data.dir3_oficina_contable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La oficina contable DIR3 es obligatoria para entidades públicas",
        path: ["dir3_oficina_contable"],
      });
    }
    if (!data.dir3_organo_gestor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El órgano gestor DIR3 es obligatorio para entidades públicas",
        path: ["dir3_organo_gestor"],
      });
    }
    if (!data.dir3_unidad_tramitadora) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La unidad tramitadora DIR3 es obligatoria para entidades públicas",
        path: ["dir3_unidad_tramitadora"],
      });
    }
  }
});

// ─── Tipos derivados ─────────────────────────────────────────────────────────

export type ClienteFormValues = z.infer<typeof clienteSchema>;

/** Schema para modo edición (id obligatorio) */
export const clienteEditSchema = clienteBaseSchema
  .extend({
    id: z.number().int().positive(),
  })
  .superRefine((data, ctx) => {
    if (data.tipo_entidad === "Entidad_Publica") {
      if (!data.dir3_oficina_contable) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "La oficina contable DIR3 es obligatoria para entidades públicas",
          path: ["dir3_oficina_contable"],
        });
      }
      if (!data.dir3_organo_gestor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "El órgano gestor DIR3 es obligatorio para entidades públicas",
          path: ["dir3_organo_gestor"],
        });
      }
      if (!data.dir3_unidad_tramitadora) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "La unidad tramitadora DIR3 es obligatoria para entidades públicas",
          path: ["dir3_unidad_tramitadora"],
        });
      }
    }
  });

export type ClienteEditValues = z.infer<typeof clienteEditSchema>;
