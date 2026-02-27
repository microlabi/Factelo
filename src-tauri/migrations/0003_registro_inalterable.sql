-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0003: Registro de Facturación Inalterable (Veri*factu / Camino 2)
-- Ley 8/2022 Crea y Crece · Orden HAP/1650/2015 Anexo II
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabla de Log de Eventos Seguro ────────────────────────────────────────
--
--  Cada fila representa un evento de ciclo de vida de una factura.
--  El campo hash_log es el SHA-256 de la tupla canónica del evento,
--  encadenado con hash_anterior (hash_log de la fila anterior).
--  Esto garantiza que cualquier manipulación sea detectable.
--
CREATE TABLE IF NOT EXISTS log_eventos_seguros (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    tipo_evento   TEXT    NOT NULL CHECK (tipo_evento IN ('GENESIS','ALTA','ANULACION')),
    empresa_id    INTEGER NOT NULL,
    factura_id    INTEGER,
    -- Identificador legible: serie+numero (ej: "A-0001")
    numero_serie  TEXT    NOT NULL DEFAULT '',
    -- SHA-256 del payload de la factura (= hash_registro de facturas)
    hash_factura  TEXT    NOT NULL,
    -- hash_log del evento INMEDIATAMENTE anterior de la misma empresa
    hash_anterior TEXT    NOT NULL,
    -- SHA-256(timestamp||tipo_evento||empresa_id||factura_id||hash_factura||hash_anterior)
    hash_log      TEXT    NOT NULL UNIQUE,
    -- Base64 de la firma XAdES del XML en el momento del alta (puede ser NULL si aún no firmado)
    firma_xades   TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (factura_id)  REFERENCES facturas(id)  ON DELETE RESTRICT,
    FOREIGN KEY (empresa_id)  REFERENCES empresas(id)  ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_log_empresa_ts
    ON log_eventos_seguros (empresa_id, created_at DESC);

-- ── 2. Inalterabilidad: bloqueo de UPDATE y DELETE ───────────────────────────
--
--  SQLite no permite revocar permisos DML a nivel de usuario, pero sí permite
--  disparadores que abortan la operación con un mensaje de error claro.
--  Estos triggers son equivalentes a NOT NULL + UNIQUE a nivel de política:
--  protegen contra cualquier herramienta que acceda directamente al .db.
--

-- Facturas: sin UPDATE ni DELETE
CREATE TRIGGER IF NOT EXISTS trg_facturas_bloquear_update
BEFORE UPDATE ON facturas
BEGIN
    SELECT RAISE(ABORT, 'INTEGRIDAD_VIOLADA: La tabla facturas es inalterable (Verifactu). Solo se permiten nuevas inscripciones. Operacion bloqueada.');
END;

CREATE TRIGGER IF NOT EXISTS trg_facturas_bloquear_delete
BEFORE DELETE ON facturas
BEGIN
    SELECT RAISE(ABORT, 'INTEGRIDAD_VIOLADA: La tabla facturas es inalterable (Verifactu). No se pueden eliminar registros. Operacion bloqueada.');
END;

-- Líneas de factura: sin UPDATE ni DELETE
CREATE TRIGGER IF NOT EXISTS trg_lineas_bloquear_update
BEFORE UPDATE ON lineas_factura
BEGIN
    SELECT RAISE(ABORT, 'INTEGRIDAD_VIOLADA: Las lineas de factura son inalterables. Operacion bloqueada.');
END;

CREATE TRIGGER IF NOT EXISTS trg_lineas_bloquear_delete
BEFORE DELETE ON lineas_factura
BEGIN
    SELECT RAISE(ABORT, 'INTEGRIDAD_VIOLADA: Las lineas de factura son inalterables. Operacion bloqueada.');
END;

-- Log de eventos: sin UPDATE ni DELETE (el log tampoco es alterable)
CREATE TRIGGER IF NOT EXISTS trg_log_bloquear_update
BEFORE UPDATE ON log_eventos_seguros
BEGIN
    SELECT RAISE(ABORT, 'INTEGRIDAD_VIOLADA: El log de eventos seguros es inalterable. Operacion bloqueada.');
END;

CREATE TRIGGER IF NOT EXISTS trg_log_bloquear_delete
BEFORE DELETE ON log_eventos_seguros
BEGIN
    SELECT RAISE(ABORT, 'INTEGRIDAD_VIOLADA: El log de eventos seguros es inalterable. Operacion bloqueada.');
END;
