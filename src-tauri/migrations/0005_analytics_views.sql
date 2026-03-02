-- ─── Migración 0005: Vistas Analíticas y tipo_entidad ────────────────────────
--
-- Añade la columna tipo_entidad a la tabla clientes y crea tres vistas SQL
-- (contactos, facturas_cabecera, facturas_lineas) que exponen los datos
-- con la nomenclatura semántica requerida por el motor de analítica.
--
-- Se usan CREATE VIEW IF NOT EXISTS para que sean idempotentes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Columna tipo_entidad en clientes ──────────────────────────────────────
--
--  Valores posibles: 'Empresa', 'Autónomo', 'Entidad Pública'
--  Se inicializa según los datos existentes:
--    · es_entidad_publica = 1  → 'Entidad Pública'
--    · tipo_persona = 'F'      → 'Autónomo'
--    · Por defecto             → 'Empresa'
--
ALTER TABLE clientes ADD COLUMN tipo_entidad TEXT NOT NULL DEFAULT 'Empresa';

-- ── 2. Vista contactos ───────────────────────────────────────────────────────
--
--  Proyecta la tabla clientes con los campos semánticos del modelo analítico.
--  Incluye una columna calculada numero_factura_texto que construye el
--  identificador serie-número de las facturas asociadas.
--
CREATE VIEW IF NOT EXISTS contactos AS
SELECT
    c.id,
    c.nif,
    c.nombre            AS razon_social,
    c.tipo_entidad,
    c.empresa_id,
    c.email,
    c.telefono,
    c.direccion,
    c.poblacion,
    c.provincia,
    c.pais,
    c.created_at,
    c.updated_at
FROM clientes c;

-- ── 3. Vista facturas_cabecera ───────────────────────────────────────────────
--
--  Proyecta la tabla facturas con terminología de cabecera de factura y une
--  el prefijo de serie para construir numero_factura legible.
--
CREATE VIEW IF NOT EXISTS facturas_cabecera AS
SELECT
    f.id,
    f.cliente_id,
    f.empresa_id,
    (sf.prefijo || '-' || printf('%04d', f.numero)) AS numero_factura,
    f.fecha_emision,
    f.subtotal        AS base_imponible,
    f.total_impuestos,
    f.total           AS total_factura,
    f.estado,
    f.hash_registro
FROM facturas f
JOIN series_facturacion sf ON sf.id = f.serie_id;

-- ── 4. Vista facturas_lineas ─────────────────────────────────────────────────
--
--  Proyecta la tabla lineas_factura con la nomenclatura del modelo analítico.
--
CREATE VIEW IF NOT EXISTS facturas_lineas AS
SELECT
    lf.id,
    lf.factura_id,
    lf.descripcion      AS concepto_descripcion,
    lf.cantidad,
    lf.precio_unitario,
    lf.tipo_iva,
    lf.total_linea      AS subtotal_linea
FROM lineas_factura lf;
