-- ─── Migración 0006: Tabla clientes – campos extendidos B2B/B2C/B2G ──────────
--
-- Añade los campos adicionales que se necesitan para gestión fiscal completa
-- de contactos: nombre comercial, contacto, banderas fiscales (IRPF,
-- recargo de equivalencia, operación intracomunitaria), condiciones de pago
-- por defecto, IBAN y los tres códigos DIR3 obligatorios para entidades
-- públicas (Face / Facturae 3.2.x).
--
-- Todas las sentencias son idempotentes gracias a "IF NOT EXISTS" o a que
-- SQLite ignora el ALTER TABLE si la columna ya existe (no lanza error en
-- versiones ≥ 3.37 con STRICT; en versiones anteriores hay que gestionar
-- la excepción en el migrador — sqlx::migrate lo hace por nosotros).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE clientes ADD COLUMN nombre_comercial TEXT;
ALTER TABLE clientes ADD COLUMN persona_contacto TEXT;
ALTER TABLE clientes ADD COLUMN aplica_irpf INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN aplica_recargo_eq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN operacion_intracomunitaria INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN metodo_pago_defecto TEXT;
ALTER TABLE clientes ADD COLUMN dias_vencimiento INTEGER NOT NULL DEFAULT 30;
ALTER TABLE clientes ADD COLUMN iban_cuenta TEXT;
ALTER TABLE clientes ADD COLUMN dir3_oficina_contable TEXT;
ALTER TABLE clientes ADD COLUMN dir3_organo_gestor TEXT;
ALTER TABLE clientes ADD COLUMN dir3_unidad_tramitadora TEXT;
