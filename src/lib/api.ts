/**
 * src/lib/api.ts
 *
 * Puente tipado entre el frontend React y los comandos Tauri (Rust).
 * Todas las funciones devuelven Promises que rechazan con `ApiError` si
 * el backend devuelve un error.  Usa este módulo en lugar de llamar
 * a `invoke` directamente para obtener tipado fuerte y un único punto
 * de mantenimiento.
 */

import { invoke } from "@tauri-apps/api/core";

// ─── Tipos de error ──────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export interface OnboardingStatus {
  tiene_empresa: boolean;
  tiene_serie: boolean;
  empresa_id: number | null;
}

// ─── Empresas ────────────────────────────────────────────────────────────────

export interface EmpresaRow {
  id: number;
  nombre: string;
  nif: string;
  direccion: string;
}

export interface CrearEmpresaInput {
  nombre: string;
  nif: string;
  direccion: string;
}

// ─── Series de facturación ───────────────────────────────────────────────────

export interface SerieRow {
  id: number;
  empresa_id: number;
  nombre: string;
  prefijo: string;
  siguiente_numero: number;
}

export interface CrearSerieInput {
  empresa_id: number;
  nombre: string;
  prefijo: string;
}

// ─── Clientes ────────────────────────────────────────────────────────────────

export type TipoEntidad = "Empresa" | "Autónomo" | "Entidad_Publica";

export interface ClienteRow {
  id: number;
  empresa_id: number;
  /** Razón social / nombre completo */
  nombre: string;
  /** NIF / CIF / NIE / VAT-ID */
  nif: string | null;
  nombre_comercial: string | null;
  tipo_entidad: TipoEntidad;
  email: string | null;
  telefono: string | null;
  persona_contacto: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  /** Ciudad / municipio */
  poblacion: string | null;
  provincia: string | null;
  pais: string;
  aplica_irpf: number;
  aplica_recargo_eq: number;
  operacion_intracomunitaria: number;
  metodo_pago_defecto: string | null;
  dias_vencimiento: number;
  iban_cuenta: string | null;
  dir3_oficina_contable: string | null;
  dir3_organo_gestor: string | null;
  dir3_unidad_tramitadora: string | null;
}

export interface CrearClienteInput {
  empresa_id: number;
  nombre: string;
  nif?: string;
  nombre_comercial?: string;
  tipo_entidad?: TipoEntidad;
  email?: string;
  telefono?: string;
  persona_contacto?: string;
  direccion?: string;
  codigo_postal?: string;
  poblacion?: string;
  provincia?: string;
  pais?: string;
  aplica_irpf?: boolean;
  aplica_recargo_eq?: boolean;
  operacion_intracomunitaria?: boolean;
  metodo_pago_defecto?: string;
  dias_vencimiento?: number;
  iban_cuenta?: string;
  dir3_oficina_contable?: string;
  dir3_organo_gestor?: string;
  dir3_unidad_tramitadora?: string;
}

export interface ActualizarClienteInput extends CrearClienteInput {
  id: number;
}

// ─── Productos ───────────────────────────────────────────────────────────────

export interface ProductoRow {
  id: number;
  empresa_id: number;
  nombre: string;
  descripcion: string | null;
  referencia: string | null;
  precio_unitario: number;
  tipo_iva: number;
}

export interface CrearProductoInput {
  empresa_id: number;
  nombre: string;
  descripcion?: string;
  referencia?: string;
  precio_unitario: number;
  tipo_iva: number;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardStats {
  total_facturado_centimos: number;
  iva_repercutido_centimos: number;
  iva_soportado_centimos: number;
  facturas_pendientes: number;
  facturas_emitidas_mes: number;
  variacion_mensual_pct: number;
}

// ─── Facturas ────────────────────────────────────────────────────────────────

export interface InsertFacturaInput {
  empresa_id: number;
  cliente_id: number;
  serie_id: number;
  numero: number;
  fecha_emision: string;
  /** Importe en céntimos (integer) */
  subtotal: number;
  /** Importe en céntimos (integer) */
  total_impuestos: number;
  /** Importe en céntimos (integer) */
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
  // Condiciones de pago y observaciones
  notas?: string;
  fecha_vencimiento?: string;
  metodo_pago?: string;
  cuenta_bancaria?: string;
}

export interface InsertFacturaResponse {
  id: number;
  hash_registro: string;
  hash_anterior: string | null;
}

export interface FacturaRow {
  id: number;
  numero: number;
  serie_prefijo: string;
  fecha_emision: string;
  cliente_nombre: string;
  total: number;
  total_impuestos: number;
  subtotal: number;
  estado: string;
  es_entidad_publica: number;
  hash_registro: string;
}

// ─── Registro Inalterable (Veri*factu / Camino 2) ────────────────────────────

export interface ResultadoIntegridad {
  integra: boolean;
  total_eventos: number;
  primer_evento: string | null;
  ultimo_evento: string | null;
  errores: string[];
}

export interface QrLegalResponse {
  /** Data URL SVG lista para <img src="..."> */
  svg_data_url: string;
  /** URL completa del QR de notariado AEAT */
  url: string;
}

export interface FicheroInspeccionResponse {
  ruta: string;
  total_eventos: number;
}

// ── Estadística Avanzada ─────────────────────────────────────────────────────
export interface AbcClienteRow {
  cliente_nombre: string;
  total_facturado: number;
  porcentaje_sobre_total: number;
  porcentaje_acumulado: number;
  clase_abc: "A" | "B" | "C";
}
export interface DsoClienteRow {
  cliente_nombre: string;
  total_facturado: number;
  retraso_medio_dias: number;
  riesgo: "Bajo" | "Medio" | "Alto";
}
export interface HeatmapCeldaRow {
  anio_mes: string;
  concepto: string;
  total_facturado: number;
}
export interface AdvancedStatisticsResult {
  abc: AbcClienteRow[];
  dso: DsoClienteRow[];
  heatmap: HeatmapCeldaRow[];
}
export interface AdvancedStatsPdfInput {
  empresa_id: number;
  empresa_nombre: string;
  abc: AbcClienteRow[];
  dso: DsoClienteRow[];
  heatmap: HeatmapCeldaRow[];
}

export interface LineaDetalle {
  id: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  tipo_iva: number;
  total_linea: number;
}

export interface FacturaDetalle {
  id: number;
  numero: number;
  serie_prefijo: string;
  fecha_emision: string;
  cliente_nombre: string;
  cliente_nif: string | null;
  subtotal: number;
  total_impuestos: number;
  total: number;
  estado: string;
  es_entidad_publica: number;
  lineas: LineaDetalle[];
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const api = {
  // ── Onboarding ─────────────────────────────────────────────────────────────
  verificarOnboarding: (): Promise<OnboardingStatus> =>
    invoke("verificar_onboarding"),

  // ── Empresas ───────────────────────────────────────────────────────────────
  obtenerEmpresas: (): Promise<EmpresaRow[]> =>
    invoke("obtener_empresas"),

  crearEmpresa: (input: CrearEmpresaInput): Promise<EmpresaRow> =>
    invoke("crear_empresa", { input }),

  // ── Series ─────────────────────────────────────────────────────────────────
  obtenerSeries: (empresaId: number): Promise<SerieRow[]> =>
    invoke("obtener_series", { empresaId }),

  crearSerie: (input: CrearSerieInput): Promise<SerieRow> =>
    invoke("crear_serie", { input }),

  // ── Clientes ───────────────────────────────────────────────────────────────
  obtenerClientes: (empresaId: number): Promise<ClienteRow[]> =>
    invoke("obtener_clientes", { empresaId }),

  crearCliente: (input: CrearClienteInput): Promise<ClienteRow> =>
    invoke("crear_cliente", { input }),

  actualizarCliente: (input: ActualizarClienteInput): Promise<ClienteRow> =>
    invoke("update_cliente", { input }),

  eliminarCliente: (id: number, empresaId: number): Promise<void> =>
    invoke("delete_cliente", { id, empresaId }),

  // ── Productos ──────────────────────────────────────────────────────────────
  obtenerProductos: (empresaId: number): Promise<ProductoRow[]> =>
    invoke("obtener_productos", { empresaId }),

  crearProducto: (input: CrearProductoInput): Promise<ProductoRow> =>
    invoke("crear_producto", { input }),

  // ── Dashboard ──────────────────────────────────────────────────────────────
  obtenerDashboardStats: (empresaId: number): Promise<DashboardStats> =>
    invoke("obtener_dashboard_stats", { empresaId }),

  // ── Facturas ───────────────────────────────────────────────────────────────
  insertarFactura: (input: InsertFacturaInput): Promise<InsertFacturaResponse> =>
    invoke("insert_factura", { input }),

  listarFacturas: (empresaId: number): Promise<FacturaRow[]> =>
    invoke("listar_facturas", { empresaId }),

  obtenerFacturaDetalle: (
    facturaId: number,
    empresaId: number
  ): Promise<FacturaDetalle> =>
    invoke("obtener_factura_detalle", { facturaId, empresaId }),

  /**
   * Genera el XML Facturae 3.2.x, lo firma con AutoFirma (el usuario elige
   * su certificado en la ventana de AutoFirma) y guarda el resultado.
   * Devuelve la ruta del archivo XML firmado en Documentos/Factelo/facturae/.
   */
  generarYFirmarFacturae: (
    facturaId: number,
    empresaId: number
  ): Promise<string> =>
    invoke("generar_y_firmar_facturae", { facturaId, empresaId }),

  // ── PDF ────────────────────────────────────────────────────────────────────
  generarPdf: (facturaId: number, empresaId: number): Promise<string> =>
    invoke("generate_pdf", { facturaId, empresaId }),

  /**
   * Abre un archivo local con la aplicación predeterminada del SO.
   */
  abrirArchivo: (ruta: string): Promise<void> =>
    invoke("abrir_archivo", { ruta }),

  // ── Registro Inalterable (Veri*factu / Camino 2) ───────────────────────────

  /**
   * Verifica la integridad de la cadena de hashes de log_eventos_seguros.
   * Debe llamarse en cada arranque y antes de exportar.
   */
  verificarIntegridadBd: (empresaId: number): Promise<ResultadoIntegridad> =>
    invoke("verificar_integridad_bd", { empresaId }),

  /**
   * Genera el QR técnico de notariado AEAT para la factura indicada.
   * Devuelve el SVG codificado como Data URL y la URL de verificación.
   */
  generarQrLegal: (facturaId: number, empresaId: number): Promise<QrLegalResponse> =>
    invoke("generar_qr_legal", { facturaId, empresaId }),

  /**
   * Exporta el fichero XML de inspección tributaria del año indicado.
   * Incluye todos los eventos de log encadenados + estado de integridad.
   */
  generarFicheroInspeccion: (
    empresaId: number,
    anio: number
  ): Promise<FicheroInspeccionResponse> =>
    invoke("generar_fichero_inspeccion", { empresaId, anio }),

  /** Obtiene los 3 bloques de estadística avanzada (ABC, DSO, Heatmap). */
  getAdvancedStatistics: (
    empresaId: number
  ): Promise<AdvancedStatisticsResult> =>
    invoke("get_advanced_statistics", { empresaId }),

  /** Genera el informe ejecutivo PDF con los datos de estadística avanzada. */
  generateAdvancedStatsPdf: (
    input: AdvancedStatsPdfInput
  ): Promise<string> =>
    invoke("generate_advanced_stats_pdf", { input }),
};
