import { z } from "zod";

// ─── Schema: Datos fiscales de la Empresa ─────────────────────────────────────

export const empresaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, "El nombre es obligatorio (mínimo 2 caracteres)")
    .max(200, "Máximo 200 caracteres"),
  nif: z
    .string()
    .trim()
    .regex(
      /^[A-Z0-9]{7,11}$/i,
      "NIF/CIF no válido — debe tener entre 7 y 11 caracteres alfanuméricos"
    ),
  direccion: z
    .string()
    .trim()
    .min(5, "La dirección es obligatoria")
    .max(300, "Máximo 300 caracteres"),
  codigo_postal: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "El código postal debe tener 5 dígitos")
    .optional()
    .or(z.literal("")),
  poblacion: z.string().trim().max(100, "Máximo 100 caracteres").optional().or(z.literal("")),
  provincia: z.string().trim().max(100, "Máximo 100 caracteres").optional().or(z.literal("")),
  telefono: z.string().trim().max(20, "Máximo 20 caracteres").optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .email("Email no válido")
    .max(200, "Máximo 200 caracteres")
    .optional()
    .or(z.literal("")),
  // Rutas locales — se rellenan a través de diálogos nativos, no por input de texto
  logo_path: z.string().optional().or(z.literal("")),
});

export type EmpresaFormValues = z.infer<typeof empresaSchema>;

export const defaultEmpresaValues: EmpresaFormValues = {
  nombre: "",
  nif: "",
  direccion: "",
  codigo_postal: "",
  poblacion: "",
  provincia: "",
  telefono: "",
  email: "",
  logo_path: "",
};

// ─── Schema: Serie de Facturación ─────────────────────────────────────────────

export const serieSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(200, "Máximo 200 caracteres"),
  prefijo: z
    .string()
    .trim()
    .min(1, "El prefijo es obligatorio")
    .max(20, "Máximo 20 caracteres")
    .regex(
      /^[A-Z0-9\-_]+$/i,
      "Solo letras, números, guiones y guiones bajos"
    ),
  siguiente_numero: z.coerce
    .number({ invalid_type_error: "Debe ser un número" })
    .int("Debe ser un número entero")
    .min(1, "Mínimo 1")
    .max(999_999, "Número demasiado grande"),
});

export type SerieFormValues = z.infer<typeof serieSchema>;

export const defaultSerieValues: SerieFormValues = {
  nombre: "",
  prefijo: "",
  siguiente_numero: 1,
};
