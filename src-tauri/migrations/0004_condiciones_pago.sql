-- ─── Migración 0004: Condiciones de Pago y Observaciones ───────────────────
-- Añade los campos comerciales obligatorios para una factura válida en España:
--   · notas           → Observaciones / texto libre del pie de factura
--   · fecha_vencimiento → Fecha límite de pago (ISO-8601)
--   · metodo_pago     → Forma de pago (transferencia, efectivo, tarjeta, recibo_domiciliado)
--   · cuenta_bancaria → IBAN o número de cuenta del emisor

ALTER TABLE facturas ADD COLUMN notas TEXT;
ALTER TABLE facturas ADD COLUMN fecha_vencimiento TEXT;
ALTER TABLE facturas ADD COLUMN metodo_pago TEXT;
ALTER TABLE facturas ADD COLUMN cuenta_bancaria TEXT;
