-- ─── Migración 0002: Campos extra para Facturae (entidad pública, DIR3, rectificativa) ────
-- Orden HAP/1650/2015 - Anexo II

-- ─── Empresas: tipo de persona, dirección completa ────────────────────────────
ALTER TABLE empresas ADD COLUMN tipo_persona TEXT NOT NULL DEFAULT 'J';
ALTER TABLE empresas ADD COLUMN codigo_postal TEXT;
ALTER TABLE empresas ADD COLUMN poblacion TEXT;
ALTER TABLE empresas ADD COLUMN provincia TEXT;

-- ─── Clientes: tipo de persona, apellidos (para persona física) ───────────────
ALTER TABLE clientes ADD COLUMN tipo_persona TEXT NOT NULL DEFAULT 'J';
ALTER TABLE clientes ADD COLUMN primer_apellido TEXT;
ALTER TABLE clientes ADD COLUMN segundo_apellido TEXT;

-- ─── Facturas: campos Facturae / entidad pública ──────────────────────────────

-- Indica si el destinatario es entidad pública (requiere Facturae + DIR3)
ALTER TABLE facturas ADD COLUMN es_entidad_publica INTEGER NOT NULL DEFAULT 0;

-- Códigos DIR3 de la Administración Pública (obligatorios si es_entidad_publica = 1)
--   RoleTypeCode 01 → Oficina Contable
--   RoleTypeCode 02 → Órgano Gestor
--   RoleTypeCode 03 → Unidad Tramitadora
ALTER TABLE facturas ADD COLUMN dir3_oficina_contable TEXT;
ALTER TABLE facturas ADD COLUMN dir3_organo_gestor TEXT;
ALTER TABLE facturas ADD COLUMN dir3_unidad_tramitadora TEXT;

-- Factura rectificativa: tipo (01 sustitución, 02 anulación, 03 descuento, 04 autorizado)
ALTER TABLE facturas ADD COLUMN tipo_rectificativa TEXT;
ALTER TABLE facturas ADD COLUMN numero_factura_rectificada TEXT;
ALTER TABLE facturas ADD COLUMN serie_factura_rectificada TEXT;

-- Cesionario (cedente): NIF y nombre — debe ser distinto del emisor
ALTER TABLE facturas ADD COLUMN cesionario_nif TEXT;
ALTER TABLE facturas ADD COLUMN cesionario_nombre TEXT;
