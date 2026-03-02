// ─── Tipos compartidos entre frontend y backend ──────────────────────────────

export type EstadoFactura = "BORRADOR" | "EMITIDA" | "ANULADA";

export interface Factura {
  id: number;
  empresa_id: number;
  cliente_id: number;
  serie_id: number;
  numero: number;
  fecha_emision: string;
  subtotal: number;
  total_impuestos: number;
  total: number;
  hash_registro: string;
  hash_anterior: string | null;
  firma_app: string;
  estado: EstadoFactura;
  created_at: string;
}

export interface Cliente {
  id: number;
  empresa_id: number;
  nombre: string;
  nif: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  poblacion: string | null;
  provincia: string | null;
  pais: string;
}

export interface Empresa {
  id: number;
  usuario_id: number;
  nombre: string;
  nif: string;
  direccion: string;
  logo: string | null;
}

export interface ProductoServicio {
  id: number;
  empresa_id: number;
  nombre: string;
  descripcion: string | null;
  referencia: string | null;
  precio_unitario: number;
  tipo_iva: number;
}

export interface DashboardStats {
  total_facturado: number;
  iva_repercutido: number;
  iva_soportado: number;
  facturas_pendientes: number;
  facturas_emitidas_mes: number;
  variacion_mensual_pct: number;
}
