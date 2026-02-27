PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    backup_path_config TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS empresas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    nif TEXT NOT NULL,
    direccion TEXT NOT NULL,
    logo BLOB,
    cert_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    UNIQUE (usuario_id, nif)
);

CREATE TABLE IF NOT EXISTS series_facturacion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    prefijo TEXT NOT NULL,
    siguiente_numero INTEGER NOT NULL DEFAULT 1 CHECK (siguiente_numero > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
    UNIQUE (empresa_id, nombre),
    UNIQUE (empresa_id, prefijo)
);

CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    nif TEXT,
    email TEXT,
    telefono TEXT,
    direccion TEXT,
    codigo_postal TEXT,
    poblacion TEXT,
    provincia TEXT,
    pais TEXT DEFAULT 'ES',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS productos_servicios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    referencia TEXT,
    precio_unitario INTEGER NOT NULL DEFAULT 0,
    tipo_iva REAL NOT NULL DEFAULT 21,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS facturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    cliente_id INTEGER NOT NULL,
    serie_id INTEGER NOT NULL,
    numero INTEGER NOT NULL CHECK (numero > 0),
    fecha_emision TEXT NOT NULL,
    subtotal INTEGER NOT NULL DEFAULT 0,
    total_impuestos INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    hash_registro TEXT NOT NULL,
    hash_anterior TEXT,
    firma_app TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'BORRADOR',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT,
    FOREIGN KEY (serie_id) REFERENCES series_facturacion(id) ON DELETE RESTRICT,
    UNIQUE (empresa_id, serie_id, numero),
    UNIQUE (hash_registro)
);

CREATE TABLE IF NOT EXISTS lineas_factura (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER NOT NULL,
    producto_servicio_id INTEGER,
    descripcion TEXT NOT NULL,
    cantidad REAL NOT NULL CHECK (cantidad > 0),
    precio_unitario INTEGER NOT NULL,
    tipo_iva REAL NOT NULL DEFAULT 21,
    total_linea INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_servicio_id) REFERENCES productos_servicios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS gastos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    proveedor TEXT NOT NULL,
    concepto TEXT NOT NULL,
    fecha TEXT NOT NULL,
    base_imponible INTEGER NOT NULL DEFAULT 0,
    tipo_iva REAL NOT NULL DEFAULT 21,
    cuota_iva INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_empresas_usuario_id ON empresas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_series_empresa_id ON series_facturacion(empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa_id ON clientes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_nif ON clientes(nif);
CREATE INDEX IF NOT EXISTS idx_productos_empresa_id ON productos_servicios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_productos_referencia ON productos_servicios(referencia);
CREATE INDEX IF NOT EXISTS idx_facturas_empresa_id ON facturas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente_id ON facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_serie_numero ON facturas(serie_id, numero);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha_emision ON facturas(fecha_emision);
CREATE INDEX IF NOT EXISTS idx_facturas_hash_anterior ON facturas(hash_anterior);
CREATE INDEX IF NOT EXISTS idx_lineas_factura_factura_id ON lineas_factura(factura_id);
CREATE INDEX IF NOT EXISTS idx_gastos_empresa_id ON gastos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha);

CREATE VIRTUAL TABLE IF NOT EXISTS clientes_fts USING fts5(
    nombre,
    nif,
    email,
    direccion,
    content='clientes',
    content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS productos_servicios_fts USING fts5(
    nombre,
    descripcion,
    referencia,
    content='productos_servicios',
    content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS facturas_fts USING fts5(
    numero,
    fecha_emision,
    hash_registro,
    content='facturas',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS clientes_ai AFTER INSERT ON clientes BEGIN
    INSERT INTO clientes_fts(rowid, nombre, nif, email, direccion)
    VALUES (new.id, new.nombre, COALESCE(new.nif, ''), COALESCE(new.email, ''), COALESCE(new.direccion, ''));
END;

CREATE TRIGGER IF NOT EXISTS clientes_ad AFTER DELETE ON clientes BEGIN
    INSERT INTO clientes_fts(clientes_fts, rowid, nombre, nif, email, direccion)
    VALUES ('delete', old.id, old.nombre, COALESCE(old.nif, ''), COALESCE(old.email, ''), COALESCE(old.direccion, ''));
END;

CREATE TRIGGER IF NOT EXISTS clientes_au AFTER UPDATE ON clientes BEGIN
    INSERT INTO clientes_fts(clientes_fts, rowid, nombre, nif, email, direccion)
    VALUES ('delete', old.id, old.nombre, COALESCE(old.nif, ''), COALESCE(old.email, ''), COALESCE(old.direccion, ''));
    INSERT INTO clientes_fts(rowid, nombre, nif, email, direccion)
    VALUES (new.id, new.nombre, COALESCE(new.nif, ''), COALESCE(new.email, ''), COALESCE(new.direccion, ''));
END;

CREATE TRIGGER IF NOT EXISTS productos_servicios_ai AFTER INSERT ON productos_servicios BEGIN
    INSERT INTO productos_servicios_fts(rowid, nombre, descripcion, referencia)
    VALUES (new.id, new.nombre, COALESCE(new.descripcion, ''), COALESCE(new.referencia, ''));
END;

CREATE TRIGGER IF NOT EXISTS productos_servicios_ad AFTER DELETE ON productos_servicios BEGIN
    INSERT INTO productos_servicios_fts(productos_servicios_fts, rowid, nombre, descripcion, referencia)
    VALUES ('delete', old.id, old.nombre, COALESCE(old.descripcion, ''), COALESCE(old.referencia, ''));
END;

CREATE TRIGGER IF NOT EXISTS productos_servicios_au AFTER UPDATE ON productos_servicios BEGIN
    INSERT INTO productos_servicios_fts(productos_servicios_fts, rowid, nombre, descripcion, referencia)
    VALUES ('delete', old.id, old.nombre, COALESCE(old.descripcion, ''), COALESCE(old.referencia, ''));
    INSERT INTO productos_servicios_fts(rowid, nombre, descripcion, referencia)
    VALUES (new.id, new.nombre, COALESCE(new.descripcion, ''), COALESCE(new.referencia, ''));
END;

CREATE TRIGGER IF NOT EXISTS facturas_ai AFTER INSERT ON facturas BEGIN
    INSERT INTO facturas_fts(rowid, numero, fecha_emision, hash_registro)
    VALUES (new.id, CAST(new.numero AS TEXT), new.fecha_emision, new.hash_registro);
END;

CREATE TRIGGER IF NOT EXISTS facturas_ad AFTER DELETE ON facturas BEGIN
    INSERT INTO facturas_fts(facturas_fts, rowid, numero, fecha_emision, hash_registro)
    VALUES ('delete', old.id, CAST(old.numero AS TEXT), old.fecha_emision, old.hash_registro);
END;

CREATE TRIGGER IF NOT EXISTS facturas_au AFTER UPDATE ON facturas BEGIN
    INSERT INTO facturas_fts(facturas_fts, rowid, numero, fecha_emision, hash_registro)
    VALUES ('delete', old.id, CAST(old.numero AS TEXT), old.fecha_emision, old.hash_registro);
    INSERT INTO facturas_fts(rowid, numero, fecha_emision, hash_registro)
    VALUES (new.id, CAST(new.numero AS TEXT), new.fecha_emision, new.hash_registro);
END;

INSERT INTO clientes_fts(clientes_fts) VALUES ('rebuild');
INSERT INTO productos_servicios_fts(productos_servicios_fts) VALUES ('rebuild');
INSERT INTO facturas_fts(facturas_fts) VALUES ('rebuild');