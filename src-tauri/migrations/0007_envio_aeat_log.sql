-- Migración: Crear tabla de log de envíos AEAT/Verifactu
CREATE TABLE IF NOT EXISTS envio_aeat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER NOT NULL,
    entorno TEXT NOT NULL,
    status INTEGER NOT NULL,
    respuesta TEXT,
    fecha_envio TEXT NOT NULL,
    FOREIGN KEY(factura_id) REFERENCES facturas(id)
);
