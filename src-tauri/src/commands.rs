use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use tauri::path::BaseDirectory;
use tauri::Manager;

use crate::{
    db::DbPool,
    facturae::{
        correction_method_description_for, correction_method_for, facturae_to_xml,
        parse_nif_country, reason_description_for, AdministrativeCentre, AdministrativeCentres,
        AddressInSpain, Batch, Corrective, FacturaeDocument, FileHeader, Individual, Invoice,
        InvoiceHeader, InvoiceIssueData, InvoiceLine, InvoiceTotals, Invoices, Items, LegalEntity,
        Parties, Party, Tax, TaxAmount, TaxIdentification, TaxPeriod, TaxesOutputs,
    },
    error::{ApiError, AppError, AppResult, CommandResult},
};

#[derive(Debug, Clone, Deserialize)]
pub struct InsertFacturaLineaInput {
    pub descripcion: String,
    pub cantidad: f64,
    pub precio_unitario: i64,
    pub tipo_iva: f64,
    pub total_linea: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InsertFacturaInput {
    pub empresa_id: i64,
    pub cliente_id: i64,
    pub serie_id: i64,
    pub numero: i64,
    pub fecha_emision: String,
    pub subtotal: i64,
    pub total_impuestos: i64,
    pub total: i64,
    pub estado: Option<String>,
    pub firma_app: Option<String>,
    pub lineas: Vec<InsertFacturaLineaInput>,
    // ─── Campos Facturae / Entidad Pública ──────────────────────────────
    pub es_entidad_publica: Option<bool>,
    pub dir3_oficina_contable: Option<String>,
    pub dir3_organo_gestor: Option<String>,
    pub dir3_unidad_tramitadora: Option<String>,
    pub tipo_rectificativa: Option<String>,
    pub numero_factura_rectificada: Option<String>,
    pub serie_factura_rectificada: Option<String>,
    pub cesionario_nif: Option<String>,
    pub cesionario_nombre: Option<String>,
    // ─── Condiciones de pago y observaciones ────────────────────────────────
    pub notas: Option<String>,
    pub fecha_vencimiento: Option<String>,
    pub metodo_pago: Option<String>,
    pub cuenta_bancaria: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InsertFacturaResponse {
    pub id: i64,
    pub hash_registro: String,
    pub hash_anterior: Option<String>,
}

#[derive(Debug, Serialize)]
struct HashSource {
    empresa_id: i64,
    cliente_id: i64,
    serie_id: i64,
    numero: i64,
    fecha_emision: String,
    subtotal: i64,
    total_impuestos: i64,
    total: i64,
    hash_anterior: String,
}

#[tauri::command]
pub async fn insert_factura(
    state: tauri::State<'_, DbPool>,
    input: InsertFacturaInput,
) -> CommandResult<InsertFacturaResponse> {
    insert_factura_internal(&state, input)
        .await
        .map_err(ApiError::from)
}

async fn insert_factura_internal(
    db: &DbPool,
    input: InsertFacturaInput,
) -> AppResult<InsertFacturaResponse> {
    validate_insert_factura(&input)?;

    // Validación: NIF del cesionario no puede coincidir con el del emisor
    // (Regla Orden HAP/1650/2015 Anexo II)
    if let Some(ref cesionario_nif) = input.cesionario_nif {
        if !cesionario_nif.trim().is_empty() {
            let empresa_nif: Option<String> = sqlx::query(
                "SELECT nif FROM empresas WHERE id = ?1 LIMIT 1",
            )
            .bind(input.empresa_id)
            .fetch_optional(db)
            .await?
            .map(|r| r.get::<String, _>("nif"));

            if let Some(nif_emisor) = empresa_nif {
                let parsed_emisor = parse_nif_country(&nif_emisor);
                let parsed_cesionario = parse_nif_country(cesionario_nif);
                if parsed_emisor.nif.to_uppercase() == parsed_cesionario.nif.to_uppercase() {
                    return Err(AppError::Validation(
                        "El NIF del cesionario no puede ser igual al NIF del emisor de la factura"
                            .to_string(),
                    ));
                }
            }
        }
    }

    let mut tx = db.begin().await?;

    let previous_hash = sqlx::query(
        r#"
        SELECT hash_registro
        FROM facturas
        WHERE empresa_id = ?1 AND serie_id = ?2
        ORDER BY numero DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(input.empresa_id)
    .bind(input.serie_id)
    .fetch_optional(&mut *tx)
    .await?
    .map(|row| row.get::<String, _>("hash_registro"));

    let chaining_value = previous_hash
        .as_ref()
        .cloned()
        .unwrap_or_else(|| "GENESIS".to_string());

    let hash_registro = calculate_chained_hash(&input, &chaining_value)?;
    let firma_app = input
        .firma_app
        .clone()
        .unwrap_or_else(|| "PENDIENTE_FIRMA_XADES".to_string());
    let estado = input.estado.clone().unwrap_or_else(|| "BORRADOR".to_string());

    let insert_result = sqlx::query(
        r#"
        INSERT INTO facturas (
            empresa_id,
            cliente_id,
            serie_id,
            numero,
            fecha_emision,
            subtotal,
            total_impuestos,
            total,
            hash_registro,
            hash_anterior,
            firma_app,
            estado,
            es_entidad_publica,
            dir3_oficina_contable,
            dir3_organo_gestor,
            dir3_unidad_tramitadora,
            tipo_rectificativa,
            numero_factura_rectificada,
            serie_factura_rectificada,
            cesionario_nif,
            cesionario_nombre,
            notas,
            fecha_vencimiento,
            metodo_pago,
            cuenta_bancaria
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
        "#,
    )
    .bind(input.empresa_id)
    .bind(input.cliente_id)
    .bind(input.serie_id)
    .bind(input.numero)
    .bind(&input.fecha_emision)
    .bind(input.subtotal)
    .bind(input.total_impuestos)
    .bind(input.total)
    .bind(&hash_registro)
    .bind(previous_hash.as_deref())
    .bind(&firma_app)
    .bind(&estado)
    .bind(input.es_entidad_publica.unwrap_or(false) as i64)
    .bind(input.dir3_oficina_contable.as_deref())
    .bind(input.dir3_organo_gestor.as_deref())
    .bind(input.dir3_unidad_tramitadora.as_deref())
    .bind(input.tipo_rectificativa.as_deref())
    .bind(input.numero_factura_rectificada.as_deref())
    .bind(input.serie_factura_rectificada.as_deref())
    .bind(input.cesionario_nif.as_deref())
    .bind(input.cesionario_nombre.as_deref())
    .bind(input.notas.as_deref())
    .bind(input.fecha_vencimiento.as_deref())
    .bind(input.metodo_pago.as_deref())
    .bind(input.cuenta_bancaria.as_deref())
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        // Detectar violación de UNIQUE (empresa_id, serie_id, numero) y devolver
        // un mensaje legible en lugar del error crudo de SQLite.
        if let sqlx::Error::Database(ref db_err) = e {
            let msg = db_err.message();
            if msg.contains("UNIQUE") && msg.contains("facturas") {
                return AppError::Validation(format!(
                    "Ya existe una factura con el número {} en esta serie. \
                     Por favor, usa un número diferente.",
                    input.numero
                ));
            }
        }
        AppError::Database(e)
    })?;

    let factura_id = insert_result.last_insert_rowid();

    // Incrementar siguiente_numero en la serie si el número insertado lo supera
    sqlx::query(
        r#"
        UPDATE series_facturacion
        SET siguiente_numero = MAX(siguiente_numero, ?1 + 1),
            updated_at        = datetime('now')
        WHERE id = ?2
        "#,
    )
    .bind(input.numero)
    .bind(input.serie_id)
    .execute(&mut *tx)
    .await?;

    for line in &input.lineas {
        sqlx::query(
            r#"
            INSERT INTO lineas_factura (
                factura_id,
                descripcion,
                cantidad,
                precio_unitario,
                tipo_iva,
                total_linea
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(factura_id)
        .bind(&line.descripcion)
        .bind(line.cantidad)
        .bind(line.precio_unitario)
        .bind(line.tipo_iva)
        .bind(line.total_linea)
        .execute(&mut *tx)
        .await?;
    }

    // ── Insertar en log_eventos_seguros (encadenamiento SHA-256) ──────────────
    //
    // El hash_log encadena el hash de la factura con el hash del evento
    // de log anterior para la misma empresa.  Así cualquier manipulación
    // de la cadena es detectable recalculando desde GENESIS.
    let previous_log_hash: Option<String> = sqlx::query(
        r#"
        SELECT hash_log
        FROM log_eventos_seguros
        WHERE empresa_id = ?1
        ORDER BY id DESC
        LIMIT 1
        "#,
    )
    .bind(input.empresa_id)
    .fetch_optional(&mut *tx)
    .await?
    .map(|r| r.get::<String, _>("hash_log"));

    let hash_anterior_log = previous_log_hash
        .as_deref()
        .unwrap_or("GENESIS")
        .to_string();

    let numero_serie_label = {
        let prefijo: Option<String> = sqlx::query(
            "SELECT prefijo FROM series_facturacion WHERE id = ?1 LIMIT 1",
        )
        .bind(input.serie_id)
        .fetch_optional(&mut *tx)
        .await?
        .map(|r| r.get::<String, _>("prefijo"));
        format!("{}-{:04}", prefijo.as_deref().unwrap_or(""), input.numero)
    };

    let timestamp_now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let hash_log = crate::audit::calcular_hash_log(
        &timestamp_now,
        "ALTA",
        input.empresa_id,
        factura_id,
        &numero_serie_label,
        &hash_registro,
        &hash_anterior_log,
    );

    sqlx::query(
        r#"
        INSERT INTO log_eventos_seguros (
            timestamp,
            tipo_evento,
            empresa_id,
            factura_id,
            numero_serie,
            hash_factura,
            hash_anterior,
            hash_log
        )
        VALUES (?1, 'ALTA', ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&timestamp_now)
    .bind(input.empresa_id)
    .bind(factura_id)
    .bind(&numero_serie_label)
    .bind(&hash_registro)
    .bind(&hash_anterior_log)
    .bind(&hash_log)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(InsertFacturaResponse {
        id: factura_id,
        hash_registro,
        hash_anterior: previous_hash,
    })
}

fn calculate_chained_hash(input: &InsertFacturaInput, hash_anterior: &str) -> AppResult<String> {
    let hash_source = HashSource {
        empresa_id: input.empresa_id,
        cliente_id: input.cliente_id,
        serie_id: input.serie_id,
        numero: input.numero,
        fecha_emision: input.fecha_emision.clone(),
        subtotal: input.subtotal,
        total_impuestos: input.total_impuestos,
        total: input.total,
        hash_anterior: hash_anterior.to_string(),
    };

    let canonical = serde_json::to_string(&hash_source)?;
    let mut sha256 = Sha256::new();
    sha256.update(canonical.as_bytes());
    Ok(hex::encode(sha256.finalize()))
}

fn validate_insert_factura(input: &InsertFacturaInput) -> AppResult<()> {
    if input.empresa_id <= 0 || input.cliente_id <= 0 || input.serie_id <= 0 {
        return Err(AppError::Validation(
            "empresa_id, cliente_id y serie_id deben ser mayores que cero".to_string(),
        ));
    }

    if input.numero <= 0 {
        return Err(AppError::Validation(
            "El número de factura debe ser mayor que cero".to_string(),
        ));
    }

    if input.fecha_emision.trim().is_empty() {
        return Err(AppError::Validation(
            "La fecha de emisión es obligatoria".to_string(),
        ));
    }

    // La fecha de emisión no puede ser posterior a la fecha actual (Anexo II HAP/1650/2015)
    let today = Local::now().format("%Y-%m-%d").to_string();
    if input.fecha_emision.as_str() > today.as_str() {
        return Err(AppError::Validation(
            "La fecha de emisión no puede ser posterior a la fecha actual".to_string(),
        ));
    }

    if input.subtotal < 0 || input.total_impuestos < 0 || input.total < 0 {
        return Err(AppError::Validation(
            "Los importes de factura no pueden ser negativos".to_string(),
        ));
    }

    if input.lineas.is_empty() {
        return Err(AppError::Validation(
            "La factura debe incluir al menos una línea".to_string(),
        ));
    }

    for line in &input.lineas {
        if line.descripcion.trim().is_empty() {
            return Err(AppError::Validation(
                "La descripción de cada línea es obligatoria".to_string(),
            ));
        }
        if line.cantidad <= 0.0 {
            return Err(AppError::Validation(
                "La cantidad de cada línea debe ser mayor que cero".to_string(),
            ));
        }
        if line.precio_unitario < 0 || line.total_linea < 0 {
            return Err(AppError::Validation(
                "Los importes de línea no pueden ser negativos".to_string(),
            ));
        }
    }

    // Validación DIR3: obligatoria si es entidad pública
    if input.es_entidad_publica.unwrap_or(false) {
        if input.dir3_oficina_contable.as_deref().unwrap_or("").trim().is_empty()
            || input.dir3_organo_gestor.as_deref().unwrap_or("").trim().is_empty()
            || input.dir3_unidad_tramitadora.as_deref().unwrap_or("").trim().is_empty()
        {
            return Err(AppError::Validation(
                "Los tres códigos DIR3 (Oficina Contable, Órgano Gestor y Unidad Tramitadora) \
                 son obligatorios para facturas a entidades públicas"
                    .to_string(),
            ));
        }
    }

    // Rectificativa tipo 01/02 requiere número de factura original
    if let Some(tipo) = &input.tipo_rectificativa {
        if (tipo == "01" || tipo == "02")
            && input
                .numero_factura_rectificada
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return Err(AppError::Validation(
                "Las facturas rectificativas de tipo 01 o 02 requieren el número \
                 de la factura original"
                    .to_string(),
            ));
        }
    }

    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
struct FacturaeInvoiceRow {
    numero: i64,
    fecha_emision: String,
    subtotal: i64,
    total_impuestos: i64,
    total: i64,
    serie_prefijo: String,
    // Empresa
    empresa_nombre: String,
    empresa_nif: String,
    empresa_direccion: String,
    empresa_tipo_persona: String,
    empresa_codigo_postal: String,
    empresa_poblacion: String,
    empresa_provincia: String,
    // Cliente
    cliente_nombre: String,
    cliente_nif: Option<String>,
    cliente_direccion: Option<String>,
    cliente_tipo_persona: String,
    cliente_codigo_postal: String,
    cliente_poblacion: String,
    cliente_provincia: String,
    // Facturae / Entidad Pública
    es_entidad_publica: i64,
    dir3_oficina_contable: Option<String>,
    dir3_organo_gestor: Option<String>,
    dir3_unidad_tramitadora: Option<String>,
    tipo_rectificativa: Option<String>,
    numero_factura_rectificada: Option<String>,
    serie_factura_rectificada: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct FacturaeLineRow {
    descripcion: String,
    cantidad: f64,
    precio_unitario: i64,
    tipo_iva: f64,
    total_linea: i64,
}

// ─── generar_y_firmar_facturae ────────────────────────────────────────────────
//
// Genera el XML Facturae 3.2.x e invoca AutoFirma para que el usuario elija
// su certificado y firme. Guarda el resultado y devuelve la ruta del archivo.

#[tauri::command]
pub async fn generar_y_firmar_facturae(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbPool>,
    factura_id: i64,
    empresa_id: i64,
) -> CommandResult<String> {
    generar_y_firmar_facturae_internal(app, &state, factura_id, empresa_id)
        .await
        .map_err(ApiError::from)
}

async fn generar_y_firmar_facturae_internal(
    app: tauri::AppHandle,
    db: &DbPool,
    factura_id: i64,
    empresa_id: i64,
) -> AppResult<String> {
    use std::process::Command;

    let (unsigned_xml, serie_prefijo, numero, fecha_emision) =
        build_facturae_sin_firmar_interno(db, factura_id, empresa_id).await?;

    // ── Archivos temporales ──────────────────────────────────────────────────
    let tmp_dir = std::env::temp_dir();
    let unsigned_path = tmp_dir.join("factelo_unsigned.xml");
    let signed_path = tmp_dir.join("factelo_signed.xml");

    let _ = std::fs::remove_file(&signed_path);
    std::fs::write(&unsigned_path, unsigned_xml.as_bytes()).map_err(AppError::Io)?;

    // ── Ejecutar AutoFirma ───────────────────────────────────────────────────
    let autofirma_bin = autofirma_binary_path();
    let status = Command::new(&autofirma_bin)
        .arg("sign")
        .arg("-certgui")
        .arg("-store")
        .arg("windows")
        .arg("-i")
        .arg(&unsigned_path)
        .arg("-o")
        .arg(&signed_path)
        .arg("-format")
        .arg("facturae")
        .arg("-algorithm")
        .arg("sha256")
        .status()
        .map_err(|e| {
            AppError::Internal(format!(
                "No se pudo lanzar AutoFirma ({}): {}. \
                 Asegúrate de que AutoFirma está instalado.",
                autofirma_bin.display(),
                e
            ))
        })?;

    let _ = std::fs::remove_file(&unsigned_path);

    if !status.success() {
        let _ = std::fs::remove_file(&signed_path);
        return Err(AppError::Internal(format!(
            "AutoFirma terminó con código {:?}. \
             El usuario puede haber cancelado la firma o no tiene certificado instalado.",
            status.code()
        )));
    }

    let signed_xml = std::fs::read_to_string(&signed_path).map_err(|e| {
        AppError::Internal(format!(
            "AutoFirma terminó correctamente pero no se encontró el archivo \
             de salida ({}): {}",
            signed_path.display(),
            e
        ))
    })?;
    let _ = std::fs::remove_file(&signed_path);

    // ── Guardar resultado ────────────────────────────────────────────────────
    let output_dir = app
        .path()
        .resolve("Factelo/facturae", BaseDirectory::Document)
        .map_err(|e| {
            AppError::Internal(format!(
                "No se pudo resolver el directorio de salida de Facturae: {e}"
            ))
        })?;

    std::fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join(format!(
        "facturae_{}_{}_{}.xml",
        serie_prefijo,
        numero,
        fecha_emision.replace('-', "")
    ));
    std::fs::write(&output_path, signed_xml.as_bytes())?;

    Ok(output_path.to_string_lossy().to_string())
}

fn autofirma_binary_path() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        // La instalación de AutoFirma coloca el CLI en un subdirectorio "Autofirma"
        let candidates = [
            r"C:\Program Files\AutoFirma\Autofirma\AutofirmaCommandLine.exe",
            r"C:\Program Files (x86)\AutoFirma\Autofirma\AutofirmaCommandLine.exe",
            // Versiones antiguas sin subcarpeta
            r"C:\Program Files\AutoFirma\AutofirmaCommandLine.exe",
            r"C:\Program Files (x86)\AutoFirma\AutofirmaCommandLine.exe",
        ];
        for path in &candidates {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return p;
            }
        }
        std::path::PathBuf::from("AutofirmaCommandLine.exe")
    }
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "/Applications/AutoFirma.app/Contents/MacOS/AutofirmaCommandLine",
            "/Applications/AutoFirma.app/Contents/MacOS/AutoFirmaCommandLine",
        ];
        for path in &candidates {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return p;
            }
        }
        std::path::PathBuf::from("AutofirmaCommandLine")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::path::PathBuf::from("autofirma")
    }
}

// ─── Helper interno: genera el XML Facturae sin firmar ───────────────────────
//
// Devuelve (xml_sin_firmar, serie_prefijo, numero, fecha_emision).

async fn build_facturae_sin_firmar_interno(
    db: &DbPool,
    factura_id: i64,
    empresa_id: i64,
) -> AppResult<(String, String, i64, String)> {
    if factura_id <= 0 || empresa_id <= 0 {
        return Err(AppError::Validation(
            "factura_id y empresa_id deben ser mayores que cero".to_string(),
        ));
    }

    let invoice = sqlx::query_as::<_, FacturaeInvoiceRow>(
        r#"
        SELECT
            f.numero,
            f.fecha_emision,
            CAST(f.subtotal AS INTEGER) AS subtotal,
            CAST(f.total_impuestos AS INTEGER) AS total_impuestos,
            CAST(f.total AS INTEGER) AS total,
            s.prefijo AS serie_prefijo,
            e.nombre AS empresa_nombre,
            e.nif AS empresa_nif,
            e.direccion AS empresa_direccion,
            COALESCE(e.tipo_persona, 'J') AS empresa_tipo_persona,
            COALESCE(e.codigo_postal, '00000') AS empresa_codigo_postal,
            COALESCE(e.poblacion, 'N/A') AS empresa_poblacion,
            COALESCE(e.provincia, 'N/A') AS empresa_provincia,
            c.nombre AS cliente_nombre,
            c.nif AS cliente_nif,
            c.direccion AS cliente_direccion,
            COALESCE(c.tipo_persona, 'J') AS cliente_tipo_persona,
            COALESCE(c.codigo_postal, '00000') AS cliente_codigo_postal,
            COALESCE(c.poblacion, 'N/A') AS cliente_poblacion,
            COALESCE(c.provincia, 'N/A') AS cliente_provincia,
            COALESCE(f.es_entidad_publica, 0) AS es_entidad_publica,
            f.dir3_oficina_contable,
            f.dir3_organo_gestor,
            f.dir3_unidad_tramitadora,
            f.tipo_rectificativa,
            f.numero_factura_rectificada,
            f.serie_factura_rectificada
        FROM facturas f
        INNER JOIN empresas e ON e.id = f.empresa_id
        INNER JOIN clientes c ON c.id = f.cliente_id
        INNER JOIN series_facturacion s ON s.id = f.serie_id
        WHERE f.id = ?1 AND f.empresa_id = ?2
        LIMIT 1
        "#,
    )
    .bind(factura_id)
    .bind(empresa_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!(
            "No existe la factura {factura_id} para la empresa {empresa_id}"
        ))
    })?;

    let lines = sqlx::query_as::<_, FacturaeLineRow>(
        r#"
        SELECT
            descripcion,
            cantidad,
            CAST(precio_unitario AS INTEGER) AS precio_unitario,
            tipo_iva,
            CAST(total_linea AS INTEGER) AS total_linea
        FROM lineas_factura
        WHERE factura_id = ?1
        ORDER BY id ASC
        "#,
    )
    .bind(factura_id)
    .fetch_all(db)
    .await?;

    if lines.is_empty() {
        return Err(AppError::Validation(
            "No se puede generar Facturae sin líneas de factura".to_string(),
        ));
    }

    let facturae_doc = build_facturae_doc(&invoice, &lines)?;
    let unsigned_xml = facturae_to_xml(&facturae_doc)?;

    Ok((unsigned_xml, invoice.serie_prefijo, invoice.numero, invoice.fecha_emision))
}

fn decimal_from_cents(cents: i64) -> rust_decimal::Decimal {
    rust_decimal::Decimal::new(cents, 2)
}

fn decimal_from_float(value: f64) -> rust_decimal::Decimal {
    value
        .to_string()
        .parse::<rust_decimal::Decimal>()
        .unwrap_or(rust_decimal::Decimal::ZERO)
}

// ─── build_facturae_doc ───────────────────────────────────────────────────────
//
// Convierte los datos de BD en un FacturaeDocument 3.2.2 con todos los
// bloques requeridos por el Anexo II de la Orden HAP/1650/2015.

fn build_facturae_doc(
    inv: &FacturaeInvoiceRow,
    lines: &[FacturaeLineRow],
) -> AppResult<FacturaeDocument> {
    // ── Parsear NIF emisor (empresa) ──────────────────────────────────────────
    let parsed_emisor = parse_nif_country(&inv.empresa_nif);

    // ── Parsear NIF receptor (cliente) ───────────────────────────────────────
    let raw_cliente_nif = inv
        .cliente_nif
        .as_deref()
        .unwrap_or("00000000X");
    let parsed_cliente = parse_nif_country(raw_cliente_nif);

    // ── IVA agrupado por tipo ────────────────────────────────────────────────
    // Para Facturae simplificamos con el tipo de IVA de la primera línea con IVA > 0,
    // o el global del subtotal / total_impuestos.
    // En un escenario multi-tipo el bloque TaxesOutputs tendría varios <Tax>.
    use std::collections::HashMap;
    let mut iva_map: HashMap<String, (i64, i64)> = HashMap::new(); // clave=rate_str, valor=(base_cents, cuota_cents)
    for line in lines {
        let rate_str = format!("{:.2}", line.tipo_iva);
        let base = line.total_linea; // en céntimos igual al coste sin IVA (simplificado)
        let cuota = (line.total_linea as f64 * line.tipo_iva / 100.0).round() as i64;
        let entry = iva_map.entry(rate_str).or_insert((0, 0));
        entry.0 += base;
        entry.1 += cuota;
    }

    // Si no hay desgloses usamos los totales globales con 21%
    let taxes: Vec<Tax> = if iva_map.is_empty() {
        vec![Tax {
            tax_type_code: "01".to_string(),
            tax_rate: decimal_from_float(21.0),
            taxable_base: TaxAmount { total_amount: decimal_from_cents(inv.subtotal) },
            tax_amount: TaxAmount { total_amount: decimal_from_cents(inv.total_impuestos) },
        }]
    } else {
        let mut taxes_vec: Vec<Tax> = iva_map
            .iter()
            .map(|(rate_str, (base, cuota))| {
                let rate: f64 = rate_str.parse().unwrap_or(21.0);
                Tax {
                    tax_type_code: "01".to_string(),
                    tax_rate: decimal_from_float(rate),
                    taxable_base: TaxAmount { total_amount: decimal_from_cents(*base) },
                    tax_amount: TaxAmount { total_amount: decimal_from_cents(*cuota) },
                }
            })
            .collect();
        taxes_vec.sort_by(|a, b| b.tax_rate.partial_cmp(&a.tax_rate).unwrap_or(std::cmp::Ordering::Equal));
        taxes_vec
    };

    // ── Líneas de factura ─────────────────────────────────────────────────────
    // GrossAmount = TotalCost (sin descuentos ni cargos en este nivel)
    let invoice_lines: Vec<InvoiceLine> = lines
        .iter()
        .map(|line| {
            let unit_price = decimal_from_cents(line.precio_unitario);
            let total_cost = decimal_from_float(line.cantidad) * unit_price;
            let gross_amount = total_cost; // GrossAmount = TotalCost - Descuentos + Cargos
            let line_iva_cuota = total_cost * decimal_from_float(line.tipo_iva / 100.0);
            InvoiceLine {
                item_description: line.descripcion.clone(),
                quantity: decimal_from_float(line.cantidad),
                unit_price_without_tax: unit_price,
                total_cost,
                gross_amount,
                taxes_outputs: TaxesOutputs {
                    tax: vec![Tax {
                        tax_type_code: "01".to_string(),
                        tax_rate: decimal_from_float(line.tipo_iva),
                        taxable_base: TaxAmount { total_amount: total_cost },
                        tax_amount: TaxAmount { total_amount: line_iva_cuota },
                    }],
                },
            }
        })
        .collect();

    // ── SellerParty ──────────────────────────────────────────────────────────
    let seller_address = AddressInSpain {
        address: inv.empresa_direccion.clone(),
        post_code: inv.empresa_codigo_postal.clone(),
        town: inv.empresa_poblacion.clone(),
        province: inv.empresa_provincia.clone(),
        country_code: parsed_emisor.country_code.clone(),
    };

    let seller_party = if inv.empresa_tipo_persona == "F" {
        let nombre_parts: Vec<&str> = inv.empresa_nombre.splitn(3, ' ').collect();
        Party {
            tax_identification: TaxIdentification {
                person_type_code: "F".to_string(),
                residence_type_code: "R".to_string(),
                tax_identification_number: parsed_emisor.nif.clone(),
            },
            administrative_centres: None,
            legal_entity: None,
            individual: Some(Individual {
                name: nombre_parts.first().copied().unwrap_or("").to_string(),
                first_surname: nombre_parts.get(1).copied().unwrap_or("").to_string(),
                second_surname: nombre_parts.get(2).map(|s| s.to_string()),
                address_in_spain: Some(seller_address),
            }),
        }
    } else {
        Party {
            tax_identification: TaxIdentification {
                person_type_code: "J".to_string(),
                residence_type_code: "R".to_string(),
                tax_identification_number: parsed_emisor.nif.clone(),
            },
            administrative_centres: None,
            legal_entity: Some(LegalEntity {
                corporate_name: inv.empresa_nombre.clone(),
                address_in_spain: Some(seller_address),
            }),
            individual: None,
        }
    };

    // ── BuyerParty ───────────────────────────────────────────────────────────
    let buyer_address = AddressInSpain {
        address: inv.cliente_direccion.clone().unwrap_or_else(|| "N/A".to_string()),
        post_code: inv.cliente_codigo_postal.clone(),
        town: inv.cliente_poblacion.clone(),
        province: inv.cliente_provincia.clone(),
        country_code: parsed_cliente.country_code.clone(),
    };

    // Centros DIR3 (obligatorios para entidad pública)
    let administrative_centres = if inv.es_entidad_publica != 0 {
        let oficina = inv.dir3_oficina_contable.clone().unwrap_or_default();
        let gestor = inv.dir3_organo_gestor.clone().unwrap_or_default();
        let tramitadora = inv.dir3_unidad_tramitadora.clone().unwrap_or_default();
        Some(AdministrativeCentres {
            administrative_centre: vec![
                AdministrativeCentre {
                    centre_code: oficina.clone(),
                    role_type_code: "01".to_string(),
                    name: format!("Oficina Contable {}", oficina),
                    address_in_spain: None,
                },
                AdministrativeCentre {
                    centre_code: gestor.clone(),
                    role_type_code: "02".to_string(),
                    name: format!("Órgano Gestor {}", gestor),
                    address_in_spain: None,
                },
                AdministrativeCentre {
                    centre_code: tramitadora.clone(),
                    role_type_code: "03".to_string(),
                    name: format!("Unidad Tramitadora {}", tramitadora),
                    address_in_spain: None,
                },
            ],
        })
    } else {
        None
    };

    let buyer_party = if inv.cliente_tipo_persona == "F" {
        let nombre_parts: Vec<&str> = inv.cliente_nombre.splitn(3, ' ').collect();
        Party {
            tax_identification: TaxIdentification {
                person_type_code: "F".to_string(),
                residence_type_code: "R".to_string(),
                tax_identification_number: parsed_cliente.nif.clone(),
            },
            administrative_centres,
            legal_entity: None,
            individual: Some(Individual {
                name: nombre_parts.first().copied().unwrap_or("").to_string(),
                first_surname: nombre_parts.get(1).copied().unwrap_or("").to_string(),
                second_surname: nombre_parts.get(2).map(|s| s.to_string()),
                address_in_spain: Some(buyer_address),
            }),
        }
    } else {
        Party {
            tax_identification: TaxIdentification {
                person_type_code: "J".to_string(),
                residence_type_code: "R".to_string(),
                tax_identification_number: parsed_cliente.nif.clone(),
            },
            administrative_centres,
            legal_entity: Some(LegalEntity {
                corporate_name: inv.cliente_nombre.clone(),
                address_in_spain: Some(buyer_address),
            }),
            individual: None,
        }
    };

    // ── Bloque Corrective (facturas rectificativas) ───────────────────────────
    let corrective = inv.tipo_rectificativa.as_deref().map(|tipo| {
        let reason_code = tipo.to_string();
        let invoice_number = inv.numero_factura_rectificada.clone();
        let invoice_series = inv.serie_factura_rectificada.clone();
        let method = correction_method_for(tipo);
        Corrective {
            invoice_number: if tipo == "01" || tipo == "02" { invoice_number } else { None },
            invoice_series_code: if tipo == "01" || tipo == "02" { invoice_series } else { None },
            reason_code: reason_code.clone(),
            reason_description: reason_description_for(&reason_code).to_string(),
            tax_period: TaxPeriod {
                start_date: inv.fecha_emision.clone(),
                end_date: inv.fecha_emision.clone(),
            },
            correction_method: method.to_string(),
            correction_method_description: correction_method_description_for(tipo).to_string(),
        }
    });

    // ── InvoiceClass: OO = Original, OR = Rectificativa ───────────────────────
    let invoice_class = if inv.tipo_rectificativa.is_some() {
        "OR".to_string()
    } else {
        "OO".to_string()
    };

    let invoice_number_str = format!("{}-{:04}", inv.serie_prefijo, inv.numero);
    let batch_total = decimal_from_cents(inv.total);

    Ok(FacturaeDocument {
        file_header: FileHeader {
            schema_version: "3.2.2".to_string(),
            modality: "I".to_string(),
            invoice_issuer_type: "EM".to_string(),
            batch: Batch {
                batch_identifier: invoice_number_str.clone(),
                invoices_count: 1,
                total_invoices_amount: batch_total,
                total_outstanding_amount: batch_total,
                total_executable_amount: batch_total,
                invoice_currency_code: "EUR".to_string(),
            },
        },
        parties: Parties { seller_party, buyer_party },
        invoices: Invoices {
            invoice: vec![Invoice {
                invoice_header: InvoiceHeader {
                    invoice_number: invoice_number_str,
                    invoice_series_code: inv.serie_prefijo.clone(),
                    invoice_document_type: "FC".to_string(),
                    invoice_class,
                },
                invoice_issue_data: InvoiceIssueData {
                    issue_date: inv.fecha_emision.clone(),
                    operation_date: inv.fecha_emision.clone(),
                    invoice_currency_code: "EUR".to_string(),
                    tax_currency_code: "EUR".to_string(),
                    language_name: "es".to_string(),
                },
                corrective,
                taxes_outputs: TaxesOutputs { tax: taxes },
                taxes_withheld: None,
                invoice_totals: InvoiceTotals {
                    total_gross_amount: decimal_from_cents(inv.subtotal),
                    total_gross_amount_before_taxes: decimal_from_cents(inv.subtotal),
                    total_tax_outputs: decimal_from_cents(inv.total_impuestos),
                    total_taxes_withheld: rust_decimal::Decimal::ZERO,
                    invoice_total: decimal_from_cents(inv.total),
                    total_outstanding_amount: decimal_from_cents(inv.total),
                    total_executable_amount: decimal_from_cents(inv.total),
                },
                items: Items { invoice_line: invoice_lines },
            }],
        },
    })
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct OnboardingStatus {
    pub tiene_empresa: bool,
    pub tiene_serie: bool,
    pub empresa_id: Option<i64>,
}

#[tauri::command]
pub async fn verificar_onboarding(
    state: tauri::State<'_, DbPool>,
) -> CommandResult<OnboardingStatus> {
    verificar_onboarding_internal(&state)
        .await
        .map_err(ApiError::from)
}

async fn verificar_onboarding_internal(db: &DbPool) -> AppResult<OnboardingStatus> {
    let empresa_row = sqlx::query("SELECT id FROM empresas LIMIT 1")
        .fetch_optional(db)
        .await?;

    let empresa_id = empresa_row.map(|r| r.get::<i64, _>("id"));
    let tiene_empresa = empresa_id.is_some();

    let tiene_serie = if let Some(eid) = empresa_id {
        sqlx::query("SELECT 1 FROM series_facturacion WHERE empresa_id = ?1 LIMIT 1")
            .bind(eid)
            .fetch_optional(db)
            .await?
            .is_some()
    } else {
        false
    };

    Ok(OnboardingStatus {
        tiene_empresa,
        tiene_serie,
        empresa_id,
    })
}

// ─── Empresas ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EmpresaRow {
    pub id: i64,
    pub nombre: String,
    pub nif: String,
    pub direccion: String,
}

#[tauri::command]
pub async fn obtener_empresas(state: tauri::State<'_, DbPool>) -> CommandResult<Vec<EmpresaRow>> {
    sqlx::query_as::<_, EmpresaRow>(
        "SELECT id, nombre, nif, direccion FROM empresas ORDER BY id ASC",
    )
    .fetch_all(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))
}

#[derive(Debug, Deserialize)]
pub struct CrearEmpresaInput {
    pub nombre: String,
    pub nif: String,
    pub direccion: String,
}

#[tauri::command]
pub async fn crear_empresa(
    state: tauri::State<'_, DbPool>,
    input: CrearEmpresaInput,
) -> CommandResult<EmpresaRow> {
    crear_empresa_internal(&state, input)
        .await
        .map_err(ApiError::from)
}

async fn crear_empresa_internal(db: &DbPool, input: CrearEmpresaInput) -> AppResult<EmpresaRow> {
    if input.nombre.trim().is_empty() || input.nif.trim().is_empty() {
        return Err(AppError::Validation(
            "El nombre y el NIF de la empresa son obligatorios".to_string(),
        ));
    }

    // Crea el usuario propietario si aún no existe (constraint FK; la autenticación
    // completa se implementará en una fase posterior)
    sqlx::query(
        "INSERT OR IGNORE INTO usuarios (id, username, password_hash, created_at, updated_at) \
         VALUES (1, 'propietario', 'NO_AUTH_YET', datetime('now'), datetime('now'))",
    )
    .execute(db)
    .await?;

    let id = sqlx::query(
        "INSERT INTO empresas (usuario_id, nombre, nif, direccion, created_at, updated_at) \
         VALUES (1, ?1, ?2, ?3, datetime('now'), datetime('now'))",
    )
    .bind(&input.nombre)
    .bind(&input.nif)
    .bind(&input.direccion)
    .execute(db)
    .await?
    .last_insert_rowid();

    Ok(EmpresaRow {
        id,
        nombre: input.nombre,
        nif: input.nif,
        direccion: input.direccion,
    })
}

// ─── Series de facturación ────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SerieRow {
    pub id: i64,
    pub empresa_id: i64,
    pub nombre: String,
    pub prefijo: String,
    pub siguiente_numero: i64,
}

#[tauri::command]
pub async fn obtener_series(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
) -> CommandResult<Vec<SerieRow>> {
    sqlx::query_as::<_, SerieRow>(
        "SELECT id, empresa_id, nombre, prefijo, siguiente_numero \
         FROM series_facturacion WHERE empresa_id = ?1 ORDER BY id ASC",
    )
    .bind(empresa_id)
    .fetch_all(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))
}

#[derive(Debug, Deserialize)]
pub struct CrearSerieInput {
    pub empresa_id: i64,
    pub nombre: String,
    pub prefijo: String,
}

#[tauri::command]
pub async fn crear_serie(
    state: tauri::State<'_, DbPool>,
    input: CrearSerieInput,
) -> CommandResult<SerieRow> {
    crear_serie_internal(&state, input)
        .await
        .map_err(ApiError::from)
}

async fn crear_serie_internal(db: &DbPool, input: CrearSerieInput) -> AppResult<SerieRow> {
    if input.nombre.trim().is_empty() || input.prefijo.trim().is_empty() {
        return Err(AppError::Validation(
            "El nombre y el prefijo de la serie son obligatorios".to_string(),
        ));
    }

    let id = sqlx::query(
        "INSERT INTO series_facturacion \
         (empresa_id, nombre, prefijo, siguiente_numero, created_at, updated_at) \
         VALUES (?1, ?2, ?3, 1, datetime('now'), datetime('now'))",
    )
    .bind(input.empresa_id)
    .bind(&input.nombre)
    .bind(&input.prefijo)
    .execute(db)
    .await?
    .last_insert_rowid();

    Ok(SerieRow {
        id,
        empresa_id: input.empresa_id,
        nombre: input.nombre,
        prefijo: input.prefijo,
        siguiente_numero: 1,
    })
}

// ─── Clientes ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ClienteRow {
    pub id: i64,
    pub empresa_id: i64,
    /// Razón social / nombre completo del cliente
    pub nombre: String,
    /// NIF / CIF / NIE / VAT-ID
    pub nif: Option<String>,
    /// Nombre comercial (puede diferir de la razón social)
    pub nombre_comercial: Option<String>,
    /// Tipo de entidad: "Empresa" | "Autónomo" | "Entidad Pública"
    pub tipo_entidad: String,
    pub email: Option<String>,
    pub telefono: Option<String>,
    pub persona_contacto: Option<String>,
    pub direccion: Option<String>,
    pub codigo_postal: Option<String>,
    pub poblacion: Option<String>,
    pub provincia: Option<String>,
    pub pais: String,
    /// 0 / 1
    pub aplica_irpf: i64,
    /// 0 / 1
    pub aplica_recargo_eq: i64,
    /// 0 / 1
    pub operacion_intracomunitaria: i64,
    pub metodo_pago_defecto: Option<String>,
    pub dias_vencimiento: i64,
    pub iban_cuenta: Option<String>,
    // ── Códigos DIR3 (obligatorios si tipo_entidad = "Entidad Pública") ──
    pub dir3_oficina_contable: Option<String>,
    pub dir3_organo_gestor: Option<String>,
    pub dir3_unidad_tramitadora: Option<String>,
}

#[tauri::command]
pub async fn obtener_clientes(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
) -> CommandResult<Vec<ClienteRow>> {
    sqlx::query_as::<_, ClienteRow>(
        "SELECT id, empresa_id, nombre, nif, nombre_comercial, tipo_entidad,
                email, telefono, persona_contacto, direccion, codigo_postal, poblacion,
                provincia, pais, aplica_irpf, aplica_recargo_eq, operacion_intracomunitaria,
                metodo_pago_defecto, dias_vencimiento, iban_cuenta,
                dir3_oficina_contable, dir3_organo_gestor, dir3_unidad_tramitadora
         FROM clientes WHERE empresa_id = ?1 ORDER BY nombre ASC",
    )
    .bind(empresa_id)
    .fetch_all(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))
}

#[derive(Debug, Deserialize)]
pub struct CrearClienteInput {
    pub empresa_id: i64,
    pub nombre: String,
    pub nif: Option<String>,
    pub nombre_comercial: Option<String>,
    pub tipo_entidad: Option<String>,
    pub email: Option<String>,
    pub telefono: Option<String>,
    pub persona_contacto: Option<String>,
    pub direccion: Option<String>,
    pub codigo_postal: Option<String>,
    pub poblacion: Option<String>,
    pub provincia: Option<String>,
    pub pais: Option<String>,
    pub aplica_irpf: Option<bool>,
    pub aplica_recargo_eq: Option<bool>,
    pub operacion_intracomunitaria: Option<bool>,
    pub metodo_pago_defecto: Option<String>,
    pub dias_vencimiento: Option<i64>,
    pub iban_cuenta: Option<String>,
    pub dir3_oficina_contable: Option<String>,
    pub dir3_organo_gestor: Option<String>,
    pub dir3_unidad_tramitadora: Option<String>,
}

fn trim_opt(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[tauri::command]
pub async fn crear_cliente(
    state: tauri::State<'_, DbPool>,
    input: CrearClienteInput,
) -> CommandResult<ClienteRow> {
    if input.empresa_id <= 0 || input.nombre.trim().is_empty() {
        return Err(ApiError::from(AppError::Validation(
            "empresa_id válido y nombre del cliente son obligatorios".to_string(),
        )));
    }

    let tipo_entidad = input
        .tipo_entidad
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("Empresa")
        .to_string();

    let pais = input
        .pais
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("ES")
        .to_string();

    let aplica_irpf = input.aplica_irpf.unwrap_or(false) as i64;
    let aplica_recargo_eq = input.aplica_recargo_eq.unwrap_or(false) as i64;
    let operacion_intracomunitaria = input.operacion_intracomunitaria.unwrap_or(false) as i64;
    let dias_vencimiento = input.dias_vencimiento.unwrap_or(30);

    let id = sqlx::query(
        "INSERT INTO clientes (
            empresa_id, nombre, nif, nombre_comercial, tipo_entidad,
            email, telefono, persona_contacto, direccion, codigo_postal, poblacion,
            provincia, pais, aplica_irpf, aplica_recargo_eq, operacion_intracomunitaria,
            metodo_pago_defecto, dias_vencimiento, iban_cuenta,
            dir3_oficina_contable, dir3_organo_gestor, dir3_unidad_tramitadora,
            created_at, updated_at
         ) VALUES (
            ?1,  ?2,  ?3,  ?4,  ?5,
            ?6,  ?7,  ?8,  ?9,  ?10, ?11,
            ?12, ?13, ?14, ?15, ?16,
            ?17, ?18, ?19,
            ?20, ?21, ?22,
            datetime('now'), datetime('now')
        )",
    )
    .bind(input.empresa_id)
    .bind(input.nombre.trim())
    .bind(trim_opt(input.nif.clone()))
    .bind(trim_opt(input.nombre_comercial.clone()))
    .bind(&tipo_entidad)
    .bind(trim_opt(input.email.clone()))
    .bind(trim_opt(input.telefono.clone()))
    .bind(trim_opt(input.persona_contacto.clone()))
    .bind(trim_opt(input.direccion.clone()))
    .bind(trim_opt(input.codigo_postal.clone()))
    .bind(trim_opt(input.poblacion.clone()))
    .bind(trim_opt(input.provincia.clone()))
    .bind(&pais)
    .bind(aplica_irpf)
    .bind(aplica_recargo_eq)
    .bind(operacion_intracomunitaria)
    .bind(trim_opt(input.metodo_pago_defecto.clone()))
    .bind(dias_vencimiento)
    .bind(trim_opt(input.iban_cuenta.clone()))
    .bind(trim_opt(input.dir3_oficina_contable.clone()))
    .bind(trim_opt(input.dir3_organo_gestor.clone()))
    .bind(trim_opt(input.dir3_unidad_tramitadora.clone()))
    .execute(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?
    .last_insert_rowid();

    Ok(ClienteRow {
        id,
        empresa_id: input.empresa_id,
        nombre: input.nombre.trim().to_string(),
        nif: trim_opt(input.nif),
        nombre_comercial: trim_opt(input.nombre_comercial),
        tipo_entidad,
        email: trim_opt(input.email),
        telefono: trim_opt(input.telefono),
        persona_contacto: trim_opt(input.persona_contacto),
        direccion: trim_opt(input.direccion),
        codigo_postal: trim_opt(input.codigo_postal),
        poblacion: trim_opt(input.poblacion),
        provincia: trim_opt(input.provincia),
        pais,
        aplica_irpf,
        aplica_recargo_eq,
        operacion_intracomunitaria,
        metodo_pago_defecto: trim_opt(input.metodo_pago_defecto),
        dias_vencimiento,
        iban_cuenta: trim_opt(input.iban_cuenta),
        dir3_oficina_contable: trim_opt(input.dir3_oficina_contable),
        dir3_organo_gestor: trim_opt(input.dir3_organo_gestor),
        dir3_unidad_tramitadora: trim_opt(input.dir3_unidad_tramitadora),
    })
}

#[derive(Debug, Deserialize)]
pub struct ActualizarClienteInput {
    pub id: i64,
    pub empresa_id: i64,
    pub nombre: String,
    pub nif: Option<String>,
    pub nombre_comercial: Option<String>,
    pub tipo_entidad: Option<String>,
    pub email: Option<String>,
    pub telefono: Option<String>,
    pub persona_contacto: Option<String>,
    pub direccion: Option<String>,
    pub codigo_postal: Option<String>,
    pub poblacion: Option<String>,
    pub provincia: Option<String>,
    pub pais: Option<String>,
    pub aplica_irpf: Option<bool>,
    pub aplica_recargo_eq: Option<bool>,
    pub operacion_intracomunitaria: Option<bool>,
    pub metodo_pago_defecto: Option<String>,
    pub dias_vencimiento: Option<i64>,
    pub iban_cuenta: Option<String>,
    pub dir3_oficina_contable: Option<String>,
    pub dir3_organo_gestor: Option<String>,
    pub dir3_unidad_tramitadora: Option<String>,
}

#[tauri::command]
pub async fn update_cliente(
    state: tauri::State<'_, DbPool>,
    input: ActualizarClienteInput,
) -> CommandResult<ClienteRow> {
    if input.id <= 0 || input.empresa_id <= 0 || input.nombre.trim().is_empty() {
        return Err(ApiError::from(AppError::Validation(
            "id, empresa_id válidos y nombre son obligatorios".to_string(),
        )));
    }

    let tipo_entidad = input
        .tipo_entidad
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("Empresa")
        .to_string();

    let pais = input
        .pais
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("ES")
        .to_string();

    let aplica_irpf = input.aplica_irpf.unwrap_or(false) as i64;
    let aplica_recargo_eq = input.aplica_recargo_eq.unwrap_or(false) as i64;
    let operacion_intracomunitaria = input.operacion_intracomunitaria.unwrap_or(false) as i64;
    let dias_vencimiento = input.dias_vencimiento.unwrap_or(30);

    sqlx::query(
        "UPDATE clientes SET
            nombre = ?1, nif = ?2, nombre_comercial = ?3, tipo_entidad = ?4,
            email = ?5, telefono = ?6, persona_contacto = ?7, direccion = ?8,
            codigo_postal = ?9, poblacion = ?10, provincia = ?11, pais = ?12,
            aplica_irpf = ?13, aplica_recargo_eq = ?14, operacion_intracomunitaria = ?15,
            metodo_pago_defecto = ?16, dias_vencimiento = ?17, iban_cuenta = ?18,
            dir3_oficina_contable = ?19, dir3_organo_gestor = ?20, dir3_unidad_tramitadora = ?21,
            updated_at = datetime('now')
         WHERE id = ?22 AND empresa_id = ?23",
    )
    .bind(input.nombre.trim())
    .bind(trim_opt(input.nif.clone()))
    .bind(trim_opt(input.nombre_comercial.clone()))
    .bind(&tipo_entidad)
    .bind(trim_opt(input.email.clone()))
    .bind(trim_opt(input.telefono.clone()))
    .bind(trim_opt(input.persona_contacto.clone()))
    .bind(trim_opt(input.direccion.clone()))
    .bind(trim_opt(input.codigo_postal.clone()))
    .bind(trim_opt(input.poblacion.clone()))
    .bind(trim_opt(input.provincia.clone()))
    .bind(&pais)
    .bind(aplica_irpf)
    .bind(aplica_recargo_eq)
    .bind(operacion_intracomunitaria)
    .bind(trim_opt(input.metodo_pago_defecto.clone()))
    .bind(dias_vencimiento)
    .bind(trim_opt(input.iban_cuenta.clone()))
    .bind(trim_opt(input.dir3_oficina_contable.clone()))
    .bind(trim_opt(input.dir3_organo_gestor.clone()))
    .bind(trim_opt(input.dir3_unidad_tramitadora.clone()))
    .bind(input.id)
    .bind(input.empresa_id)
    .execute(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?;

    Ok(ClienteRow {
        id: input.id,
        empresa_id: input.empresa_id,
        nombre: input.nombre.trim().to_string(),
        nif: trim_opt(input.nif),
        nombre_comercial: trim_opt(input.nombre_comercial),
        tipo_entidad,
        email: trim_opt(input.email),
        telefono: trim_opt(input.telefono),
        persona_contacto: trim_opt(input.persona_contacto),
        direccion: trim_opt(input.direccion),
        codigo_postal: trim_opt(input.codigo_postal),
        poblacion: trim_opt(input.poblacion),
        provincia: trim_opt(input.provincia),
        pais,
        aplica_irpf,
        aplica_recargo_eq,
        operacion_intracomunitaria,
        metodo_pago_defecto: trim_opt(input.metodo_pago_defecto),
        dias_vencimiento,
        iban_cuenta: trim_opt(input.iban_cuenta),
        dir3_oficina_contable: trim_opt(input.dir3_oficina_contable),
        dir3_organo_gestor: trim_opt(input.dir3_organo_gestor),
        dir3_unidad_tramitadora: trim_opt(input.dir3_unidad_tramitadora),
    })
}

#[tauri::command]
pub async fn delete_cliente(
    state: tauri::State<'_, DbPool>,
    id: i64,
    empresa_id: i64,
) -> CommandResult<()> {
    sqlx::query("DELETE FROM clientes WHERE id = ?1 AND empresa_id = ?2")
        .bind(id)
        .bind(empresa_id)
        .execute(state.inner())
        .await
        .map_err(|e| ApiError::from(AppError::from(e)))?;
    Ok(())
}

// ─── Productos ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProductoRow {
    pub id: i64,
    pub empresa_id: i64,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub referencia: Option<String>,
    pub precio_unitario: i64,
    pub tipo_iva: f64,
}

#[tauri::command]
pub async fn obtener_productos(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
) -> CommandResult<Vec<ProductoRow>> {
    sqlx::query_as::<_, ProductoRow>(
        "SELECT id, empresa_id, nombre, descripcion, referencia, CAST(precio_unitario AS INTEGER) as precio_unitario, tipo_iva \
         FROM productos_servicios WHERE empresa_id = ?1 ORDER BY nombre ASC",
    )
    .bind(empresa_id)
    .fetch_all(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))
}

#[derive(Debug, Deserialize)]
pub struct CrearProductoInput {
    pub empresa_id: i64,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub referencia: Option<String>,
    pub precio_unitario: i64,
    pub tipo_iva: f64,
}

#[tauri::command]
pub async fn crear_producto(
    state: tauri::State<'_, DbPool>,
    input: CrearProductoInput,
) -> CommandResult<ProductoRow> {
    if input.empresa_id <= 0 || input.nombre.trim().is_empty() {
        return Err(ApiError::from(AppError::Validation(
            "empresa_id válido y nombre del producto son obligatorios".to_string(),
        )));
    }
    if input.precio_unitario < 0 {
        return Err(ApiError::from(AppError::Validation(
            "El precio unitario no puede ser negativo".to_string(),
        )));
    }

    let id = sqlx::query(
        "INSERT INTO productos_servicios (empresa_id, nombre, descripcion, referencia, precio_unitario, tipo_iva, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'))",
    )
    .bind(input.empresa_id)
    .bind(input.nombre.trim())
    .bind(input.descripcion.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .bind(input.referencia.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .bind(input.precio_unitario)
    .bind(input.tipo_iva)
    .execute(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?
    .last_insert_rowid();

    Ok(ProductoRow {
        id,
        empresa_id: input.empresa_id,
        nombre: input.nombre.trim().to_string(),
        descripcion: input
            .descripcion
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        referencia: input
            .referencia
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        precio_unitario: input.precio_unitario,
        tipo_iva: input.tipo_iva,
    })
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct DashboardStats {
    pub total_facturado_centimos: i64,
    pub iva_repercutido_centimos: i64,
    pub iva_soportado_centimos: i64,
    pub facturas_pendientes: i64,
    pub facturas_emitidas_mes: i64,
    pub variacion_mensual_pct: f64,
}

#[tauri::command]
pub async fn obtener_dashboard_stats(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
) -> CommandResult<DashboardStats> {
    if empresa_id <= 0 {
        return Err(ApiError::from(AppError::Validation(
            "empresa_id debe ser mayor que cero".to_string(),
        )));
    }

    let totals = sqlx::query(
        "SELECT \
            COALESCE(SUM(CAST(total AS INTEGER)), 0) as total_facturado_centimos, \
            COALESCE(SUM(CAST(total_impuestos AS INTEGER)), 0) as iva_repercutido_centimos, \
            COALESCE(SUM(CASE WHEN estado = 'BORRADOR' THEN 1 ELSE 0 END), 0) as facturas_pendientes, \
            COALESCE(SUM(CASE WHEN strftime('%Y-%m', fecha_emision) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END), 0) as facturas_emitidas_mes \
         FROM facturas WHERE empresa_id = ?1",
    )
    .bind(empresa_id)
    .fetch_one(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?;

    let iva_soportado_centimos = sqlx::query(
        "SELECT COALESCE(SUM(CAST(cuota_iva AS INTEGER)), 0) as iva_soportado_centimos \
         FROM gastos WHERE empresa_id = ?1",
    )
    .bind(empresa_id)
    .fetch_one(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?
    .get::<i64, _>("iva_soportado_centimos");

    let month_totals = sqlx::query(
        "SELECT \
            COALESCE(SUM(CASE WHEN strftime('%Y-%m', fecha_emision) = strftime('%Y-%m', 'now') THEN CAST(total AS INTEGER) ELSE 0 END), 0) as total_mes_actual, \
            COALESCE(SUM(CASE WHEN strftime('%Y-%m', fecha_emision) = strftime('%Y-%m', 'now', '-1 month') THEN CAST(total AS INTEGER) ELSE 0 END), 0) as total_mes_anterior \
         FROM facturas WHERE empresa_id = ?1",
    )
    .bind(empresa_id)
    .fetch_one(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?;

    let total_mes_actual = month_totals.get::<i64, _>("total_mes_actual");
    let total_mes_anterior = month_totals.get::<i64, _>("total_mes_anterior");

    let variacion_mensual_pct = if total_mes_anterior > 0 {
        ((total_mes_actual - total_mes_anterior) as f64 / total_mes_anterior as f64) * 100.0
    } else {
        0.0
    };

    Ok(DashboardStats {
        total_facturado_centimos: totals.get::<i64, _>("total_facturado_centimos"),
        iva_repercutido_centimos: totals.get::<i64, _>("iva_repercutido_centimos"),
        iva_soportado_centimos,
        facturas_pendientes: totals.get::<i64, _>("facturas_pendientes"),
        facturas_emitidas_mes: totals.get::<i64, _>("facturas_emitidas_mes"),
        variacion_mensual_pct,
    })
}

// ─── Listar facturas ──────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct FacturaListaRow {
    pub id: i64,
    pub numero: i64,
    pub serie_prefijo: String,
    pub fecha_emision: String,
    pub cliente_nombre: String,
    pub total: i64,
    pub total_impuestos: i64,
    pub subtotal: i64,
    pub estado: String,
    pub es_entidad_publica: i64,
    pub hash_registro: String,
}

#[tauri::command]
pub async fn listar_facturas(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
) -> CommandResult<Vec<FacturaListaRow>> {
    if empresa_id <= 0 {
        return Err(ApiError::from(AppError::Validation(
            "empresa_id debe ser mayor que cero".to_string(),
        )));
    }

    let rows = sqlx::query_as::<_, FacturaListaRow>(
        r#"
        SELECT
            f.id,
            f.numero,
            s.prefijo AS serie_prefijo,
            f.fecha_emision,
            c.nombre AS cliente_nombre,
            -- Si los valores almacenados son 0 (facturas de versiones anteriores)
            -- recalcular desde lineas_factura, igual que hace el generador de PDF.
            CASE
                WHEN CAST(f.total AS INTEGER) <> 0 THEN CAST(f.total AS INTEGER)
                ELSE COALESCE(lt.total_calc, 0)
            END AS total,
            CASE
                WHEN CAST(f.total_impuestos AS INTEGER) <> 0 THEN CAST(f.total_impuestos AS INTEGER)
                ELSE COALESCE(lt.iva_calc, 0)
            END AS total_impuestos,
            CASE
                WHEN CAST(f.subtotal AS INTEGER) <> 0 THEN CAST(f.subtotal AS INTEGER)
                ELSE COALESCE(lt.subtotal_calc, 0)
            END AS subtotal,
            f.estado,
            COALESCE(f.es_entidad_publica, 0) AS es_entidad_publica,
            f.hash_registro
        FROM facturas f
        JOIN clientes c ON c.id = f.cliente_id
        JOIN series_facturacion s ON s.id = f.serie_id
        LEFT JOIN (
            SELECT
                factura_id,
                CAST(ROUND(SUM(ROUND(cantidad * precio_unitario))) AS INTEGER) AS subtotal_calc,
                CAST(ROUND(SUM(ROUND(ROUND(cantidad * precio_unitario) * tipo_iva / 100.0))) AS INTEGER) AS iva_calc,
                CAST(ROUND(SUM(
                    ROUND(cantidad * precio_unitario) +
                    ROUND(ROUND(cantidad * precio_unitario) * tipo_iva / 100.0)
                )) AS INTEGER) AS total_calc
            FROM lineas_factura
            GROUP BY factura_id
        ) lt ON lt.factura_id = f.id
        WHERE f.empresa_id = ?1
        ORDER BY f.fecha_emision DESC, f.id DESC
        "#,
    )
    .bind(empresa_id)
    .fetch_all(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?;

    Ok(rows)
}

// ─── Obtener detalle de factura con líneas ────────────────────────────────────

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct LineaDetalleRow {
    pub id: i64,
    pub descripcion: String,
    pub cantidad: f64,
    pub precio_unitario: i64,
    pub tipo_iva: f64,
    pub total_linea: i64,
}

#[derive(Debug, serde::Serialize)]
pub struct FacturaDetalleResponse {
    pub id: i64,
    pub numero: i64,
    pub serie_prefijo: String,
    pub fecha_emision: String,
    pub cliente_nombre: String,
    pub cliente_nif: Option<String>,
    pub subtotal: i64,
    pub total_impuestos: i64,
    pub total: i64,
    pub estado: String,
    pub es_entidad_publica: i64,
    pub lineas: Vec<LineaDetalleRow>,
}

#[tauri::command]
pub async fn obtener_factura_detalle(
    state: tauri::State<'_, DbPool>,
    factura_id: i64,
    empresa_id: i64,
) -> CommandResult<FacturaDetalleResponse> {
    if factura_id <= 0 || empresa_id <= 0 {
        return Err(ApiError::from(AppError::Validation(
            "factura_id y empresa_id deben ser mayores que cero".to_string(),
        )));
    }

    #[derive(Debug, sqlx::FromRow)]
    struct HeaderRow {
        id: i64,
        numero: i64,
        serie_prefijo: String,
        fecha_emision: String,
        cliente_nombre: String,
        cliente_nif: Option<String>,
        subtotal: i64,
        total_impuestos: i64,
        total: i64,
        estado: String,
        es_entidad_publica: i64,
    }

    let header = sqlx::query_as::<_, HeaderRow>(
        r#"
        SELECT
            f.id,
            f.numero,
            s.prefijo AS serie_prefijo,
            f.fecha_emision,
            c.nombre AS cliente_nombre,
            c.nif AS cliente_nif,
            CASE
                WHEN CAST(f.subtotal AS INTEGER) <> 0 THEN CAST(f.subtotal AS INTEGER)
                ELSE COALESCE(lt.subtotal_calc, 0)
            END AS subtotal,
            CASE
                WHEN CAST(f.total_impuestos AS INTEGER) <> 0 THEN CAST(f.total_impuestos AS INTEGER)
                ELSE COALESCE(lt.iva_calc, 0)
            END AS total_impuestos,
            CASE
                WHEN CAST(f.total AS INTEGER) <> 0 THEN CAST(f.total AS INTEGER)
                ELSE COALESCE(lt.total_calc, 0)
            END AS total,
            f.estado,
            COALESCE(f.es_entidad_publica, 0) AS es_entidad_publica
        FROM facturas f
        JOIN clientes c ON c.id = f.cliente_id
        JOIN series_facturacion s ON s.id = f.serie_id
        LEFT JOIN (
            SELECT
                factura_id,
                CAST(ROUND(SUM(ROUND(cantidad * precio_unitario))) AS INTEGER) AS subtotal_calc,
                CAST(ROUND(SUM(ROUND(ROUND(cantidad * precio_unitario) * tipo_iva / 100.0))) AS INTEGER) AS iva_calc,
                CAST(ROUND(SUM(
                    ROUND(cantidad * precio_unitario) +
                    ROUND(ROUND(cantidad * precio_unitario) * tipo_iva / 100.0)
                )) AS INTEGER) AS total_calc
            FROM lineas_factura
            GROUP BY factura_id
        ) lt ON lt.factura_id = f.id
        WHERE f.id = ?1 AND f.empresa_id = ?2
        LIMIT 1
        "#,
    )
    .bind(factura_id)
    .bind(empresa_id)
    .fetch_optional(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?
    .ok_or_else(|| {
        ApiError::from(AppError::NotFound(format!(
            "No existe la factura {factura_id} para la empresa {empresa_id}"
        )))
    })?;

    let lineas = sqlx::query_as::<_, LineaDetalleRow>(
        r#"
        SELECT
            id,
            descripcion,
            cantidad,
            CAST(precio_unitario AS INTEGER) AS precio_unitario,
            tipo_iva,
            CAST(total_linea AS INTEGER) AS total_linea
        FROM lineas_factura
        WHERE factura_id = ?1
        ORDER BY id ASC
        "#,
    )
    .bind(factura_id)
    .fetch_all(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?;

    Ok(FacturaDetalleResponse {
        id: header.id,
        numero: header.numero,
        serie_prefijo: header.serie_prefijo,
        fecha_emision: header.fecha_emision,
        cliente_nombre: header.cliente_nombre,
        cliente_nif: header.cliente_nif,
        subtotal: header.subtotal,
        total_impuestos: header.total_impuestos,
        total: header.total,
        estado: header.estado,
        es_entidad_publica: header.es_entidad_publica,
        lineas,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de Analítica Avanzada
// ─────────────────────────────────────────────────────────────────────────────

/// Parámetros de filtrado opcionales para el analytics.
#[derive(Debug, Deserialize)]
pub struct AdvancedAnalyticsParams {
    /// ID de la empresa sobre la que calcular analítica.
    pub empresa_id: i64,
    /// Fecha de inicio en formato ISO-8601 (inclusive), ej. "2026-01-01".
    pub fecha_inicio: Option<String>,
    /// Fecha de fin en formato ISO-8601 (inclusive), ej. "2026-03-31".
    pub fecha_fin: Option<String>,
    /// Tipo de entidad: "Empresa", "Autónomo" o "Entidad Pública".
    pub tipo_entidad: Option<String>,
    /// Texto libre para filtrar por concepto/descripción de línea de factura.
    pub texto_producto: Option<String>,
}

/// Resultado que devuelve el motor de analítica.
#[derive(Debug, Serialize)]
pub struct AdvancedAnalyticsResult {
    /// Suma de bases imponibles (subtotales, en céntimos).
    pub total_base_imponible: i64,
    /// Suma de totales de factura con IVA incluido (en céntimos).
    pub total_facturado: i64,
    /// Número de facturas que cumplen los filtros.
    pub num_facturas: i64,
    /// Número de líneas de factura que cumplen los filtros.
    pub num_lineas: i64,
}

#[tauri::command]
pub async fn get_advanced_analytics(
    state: tauri::State<'_, DbPool>,
    params: AdvancedAnalyticsParams,
) -> CommandResult<AdvancedAnalyticsResult> {
    get_advanced_analytics_internal(state.inner(), params)
        .await
        .map_err(ApiError::from)
}

async fn get_advanced_analytics_internal(
    db: &DbPool,
    params: AdvancedAnalyticsParams,
) -> AppResult<AdvancedAnalyticsResult> {
    // ── Construir query dinámica con filtros opcionales ───────────────────────
    //
    //  JOIN: facturas_cabecera → contactos (cliente) → facturas_lineas (líneas)
    //
    //  Para evitar inyección SQL los valores se pasan como bind parameters (?N).
    //  Solo el número de cláusulas WHERE cambia en función de los filtros
    //  proporcionados; los placeholders son estáticos por posición.
    //
    //  Índice de parámetros:
    //    ?1  → empresa_id       (siempre presente)
    //    ?2  → fecha_inicio     (si Some)
    //    ?3  → fecha_fin        (si Some)
    //    ?4  → tipo_entidad     (si Some y no vacío)
    //    ?5  → texto_producto   (si Some y no vacío); se pasa como "%valor%"
    let mut conditions: Vec<&str> = Vec::new();
    let mut bind_index: u8 = 1; // ?1 ya reservado para empresa_id

    // ?2 fecha_inicio
    let bind_fecha_inicio = params.fecha_inicio.as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    if bind_fecha_inicio.is_some() {
        bind_index += 1;
        conditions.push("fc.fecha_emision >= ?2");
    }

    // ?3 fecha_fin
    let bind_fecha_fin = params.fecha_fin.as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    if bind_fecha_fin.is_some() {
        bind_index += 1;
        conditions.push("fc.fecha_emision <= ?3");
    }
    let _ = bind_index; // evitar warning de variable no usada

    // ?4 tipo_entidad
    let bind_tipo_entidad = params.tipo_entidad.as_deref()
        .filter(|s| !s.trim().is_empty() && *s != "Todos")
        .map(|s| s.to_string());

    // ?5 texto_producto
    let bind_texto = params.texto_producto.as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("%{}%", s));

    // Componer cláusula WHERE dinámica
    let mut where_clause = String::from("WHERE fc.empresa_id = ?1");
    if bind_fecha_inicio.is_some() {
        where_clause.push_str(" AND fc.fecha_emision >= ?2");
    }
    if bind_fecha_fin.is_some() {
        where_clause.push_str(" AND fc.fecha_emision <= ?3");
    }
    if bind_tipo_entidad.is_some() {
        where_clause.push_str(" AND c.tipo_entidad = ?4");
    }
    if bind_texto.is_some() {
        where_clause.push_str(" AND fl.concepto_descripcion LIKE ?5");
    }

    let sql = format!(
        r#"
        SELECT
            COALESCE(SUM(DISTINCT fc.base_imponible), 0)  AS total_base_imponible,
            COALESCE(SUM(DISTINCT fc.total_factura),   0) AS total_facturado,
            COUNT(DISTINCT fc.id)                         AS num_facturas,
            COUNT(fl.id)                                  AS num_lineas
        FROM facturas_cabecera fc
        JOIN contactos          c  ON c.id = fc.cliente_id
        JOIN facturas_lineas    fl ON fl.factura_id = fc.id
        {where_clause}
        "#
    );

    let row = sqlx::query(&sql)
        .bind(params.empresa_id)
        .bind(bind_fecha_inicio.as_deref())
        .bind(bind_fecha_fin.as_deref())
        .bind(bind_tipo_entidad.as_deref())
        .bind(bind_texto.as_deref())
        .fetch_one(db)
        .await?;

    Ok(AdvancedAnalyticsResult {
        total_base_imponible: row.get::<i64, _>("total_base_imponible"),
        total_facturado:      row.get::<i64, _>("total_facturado"),
        num_facturas:         row.get::<i64, _>("num_facturas"),
        num_lineas:           row.get::<i64, _>("num_lineas"),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Módulo de Estadística Avanzada y Predictiva
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AbcClienteRow {
    pub cliente_nombre: String,
    pub total_facturado: i64,
    pub porcentaje_sobre_total: f64,
    pub porcentaje_acumulado: f64,
    pub clase_abc: String,
}

#[derive(Debug, Serialize)]
pub struct DsoClienteRow {
    pub cliente_nombre: String,
    pub total_facturado: i64,
    pub retraso_medio_dias: f64,
    pub riesgo: String,
}

#[derive(Debug, Serialize)]
pub struct HeatmapCeldaRow {
    pub anio_mes: String,
    pub concepto: String,
    pub total_facturado: i64,
}

#[derive(Debug, Serialize)]
pub struct AdvancedStatisticsResult {
    pub abc: Vec<AbcClienteRow>,
    pub dso: Vec<DsoClienteRow>,
    pub heatmap: Vec<HeatmapCeldaRow>,
}

#[tauri::command]
pub async fn get_advanced_statistics(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
) -> CommandResult<AdvancedStatisticsResult> {
    get_advanced_statistics_internal(state.inner(), empresa_id)
        .await
        .map_err(ApiError::from)
}

async fn get_advanced_statistics_internal(
    db: &DbPool,
    empresa_id: i64,
) -> AppResult<AdvancedStatisticsResult> {
    if empresa_id <= 0 {
        return Err(AppError::Validation(
            "empresa_id debe ser mayor que cero".to_string(),
        ));
    }

    // ── 1. Análisis ABC / Pareto ──────────────────────────────────────────
    #[derive(Debug, sqlx::FromRow)]
    struct AbcRow {
        cliente_nombre: String,
        total_facturado: i64,
        porcentaje_sobre_total: f64,
        porcentaje_acumulado: f64,
        clase_abc: String,
    }

    let abc_rows = sqlx::query_as::<_, AbcRow>(
        r#"
        WITH ventas AS (
            SELECT
                c.nombre AS cliente_nombre,
                SUM(
                    CASE WHEN f.total > 0 THEN f.total
                         ELSE COALESCE(lt.total_calc, 0)
                    END
                ) AS total_facturado
            FROM facturas f
            JOIN clientes c ON c.id = f.cliente_id
            LEFT JOIN (
                SELECT factura_id, SUM(total_linea) AS total_calc
                FROM lineas_factura GROUP BY factura_id
            ) lt ON lt.factura_id = f.id
            WHERE f.empresa_id = ?1 AND f.estado <> 'ANULADA'
            GROUP BY f.cliente_id, c.nombre
        ),
        total_global AS (
            SELECT COALESCE(SUM(total_facturado), 1) AS grand_total FROM ventas
        ),
        ranking AS (
            SELECT
                v.cliente_nombre,
                v.total_facturado,
                COALESCE(ROUND(v.total_facturado * 100.0 / NULLIF(t.grand_total, 0), 2), 0.0) AS porcentaje_sobre_total,
                SUM(v.total_facturado)
                    OVER (ORDER BY v.total_facturado DESC
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS acumulado_raw,
                t.grand_total
            FROM ventas v, total_global t
        )
        SELECT
            cliente_nombre,
            total_facturado,
            porcentaje_sobre_total,
            COALESCE(ROUND(acumulado_raw * 100.0 / NULLIF(grand_total, 0), 2), 0.0) AS porcentaje_acumulado,
            CASE
                WHEN COALESCE(ROUND(acumulado_raw * 100.0 / NULLIF(grand_total, 0), 2), 0.0) <= 80 THEN 'A'
                WHEN COALESCE(ROUND(acumulado_raw * 100.0 / NULLIF(grand_total, 0), 2), 0.0) <= 95 THEN 'B'
                ELSE 'C'
            END AS clase_abc
        FROM ranking
        ORDER BY total_facturado DESC
        "#,
    )
    .bind(empresa_id)
    .fetch_all(db)
    .await?;

    // ── 2. DSO Predictivo (Days Sales Outstanding) ────────────────────────
    // Usa fecha_vencimiento como proxy del plazo de cobro. Si no está
    // informada, asume el plazo estándar de 30 días del campo dias_vencimiento
    // del cliente (si existe) o 30 días por defecto.
    #[derive(Debug, sqlx::FromRow)]
    struct DsoRow {
        cliente_nombre: String,
        total_facturado: i64,
        retraso_medio_dias: f64,
    }

    let dso_rows = sqlx::query_as::<_, DsoRow>(
        r#"
        SELECT
            c.nombre AS cliente_nombre,
            SUM(
                CASE WHEN f.total > 0 THEN f.total
                     ELSE COALESCE(lt.total_calc, 0)
                END
            ) AS total_facturado,
            AVG(
                CASE
                    WHEN f.fecha_vencimiento IS NOT NULL AND f.fecha_vencimiento <> ''
                    THEN ABS(CAST(JULIANDAY(f.fecha_vencimiento) - JULIANDAY(f.fecha_emision) AS REAL))
                    ELSE CAST(COALESCE(c.dias_vencimiento, 30) AS REAL)
                END
            ) AS retraso_medio_dias
        FROM facturas f
        JOIN clientes c ON c.id = f.cliente_id
        LEFT JOIN (
            SELECT factura_id, SUM(total_linea) AS total_calc
            FROM lineas_factura GROUP BY factura_id
        ) lt ON lt.factura_id = f.id
        WHERE f.empresa_id = ?1 AND f.estado <> 'ANULADA'
        GROUP BY f.cliente_id, c.nombre
        ORDER BY retraso_medio_dias DESC
        "#,
    )
    .bind(empresa_id)
    .fetch_all(db)
    .await?;

    // ── 3. Heatmap Temporal (Top‑8 conceptos × mes) ───────────────────────
    #[derive(Debug, sqlx::FromRow)]
    struct HeatmapRow {
        anio_mes: String,
        concepto: String,
        total_facturado: i64,
    }

    let heatmap_rows = sqlx::query_as::<_, HeatmapRow>(
        r#"
        WITH top_conceptos AS (
            SELECT lf.descripcion AS concepto
            FROM lineas_factura lf
            JOIN facturas f ON f.id = lf.factura_id
            WHERE f.empresa_id = ?1 AND f.estado <> 'ANULADA'
            GROUP BY lf.descripcion
            ORDER BY SUM(lf.total_linea) DESC
            LIMIT 8
        )
        SELECT
            strftime('%Y-%m', f.fecha_emision) AS anio_mes,
            lf.descripcion                     AS concepto,
            SUM(lf.total_linea)                AS total_facturado
        FROM lineas_factura lf
        JOIN facturas f ON f.id = lf.factura_id
        WHERE f.empresa_id = ?1
          AND f.estado <> 'ANULADA'
          AND lf.descripcion IN (SELECT concepto FROM top_conceptos)
        GROUP BY anio_mes, lf.descripcion
        ORDER BY anio_mes ASC, total_facturado DESC
        "#,
    )
    .bind(empresa_id)
    .fetch_all(db)
    .await?;

    // ── Mapear a structs de respuesta ─────────────────────────────────────
    let abc: Vec<AbcClienteRow> = abc_rows
        .into_iter()
        .map(|r| AbcClienteRow {
            cliente_nombre: r.cliente_nombre,
            total_facturado: r.total_facturado,
            porcentaje_sobre_total: r.porcentaje_sobre_total,
            porcentaje_acumulado: r.porcentaje_acumulado,
            clase_abc: r.clase_abc,
        })
        .collect();

    let dso: Vec<DsoClienteRow> = dso_rows
        .into_iter()
        .map(|r| DsoClienteRow {
            riesgo: classify_dso_risk(r.retraso_medio_dias),
            cliente_nombre: r.cliente_nombre,
            total_facturado: r.total_facturado,
            retraso_medio_dias: (r.retraso_medio_dias * 10.0).round() / 10.0,
        })
        .collect();

    let heatmap: Vec<HeatmapCeldaRow> = heatmap_rows
        .into_iter()
        .map(|r| HeatmapCeldaRow {
            anio_mes: r.anio_mes,
            concepto: r.concepto,
            total_facturado: r.total_facturado,
        })
        .collect();

    Ok(AdvancedStatisticsResult { abc, dso, heatmap })
}

fn classify_dso_risk(dias: f64) -> String {
    if dias <= 30.0 {
        "Bajo".to_string()
    } else if dias <= 60.0 {
        "Medio".to_string()
    } else {
        "Alto".to_string()
    }
}

