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
    xades::{sign_xml_xades, XadesSignInput},
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
            cesionario_nombre
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
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
    empresa_cert_path: Option<String>,
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

#[tauri::command]
pub async fn generar_facturae_xml(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbPool>,
    factura_id: i64,
    empresa_id: i64,
    cert_password: String,
) -> CommandResult<String> {
    generar_facturae_xml_internal(app, &state, factura_id, empresa_id, cert_password)
        .await
        .map_err(ApiError::from)
}

async fn generar_facturae_xml_internal(
    app: tauri::AppHandle,
    db: &DbPool,
    factura_id: i64,
    empresa_id: i64,
    cert_password: String,
) -> AppResult<String> {
    if factura_id <= 0 || empresa_id <= 0 {
        return Err(AppError::Validation(
            "factura_id y empresa_id deben ser mayores que cero".to_string(),
        ));
    }

    if cert_password.trim().is_empty() {
        return Err(AppError::Validation(
            "La contraseña del certificado es obligatoria".to_string(),
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
            e.cert_path AS empresa_cert_path,
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

    let cert_path = invoice
        .empresa_cert_path
        .clone()
        .ok_or_else(|| AppError::Certificate("La empresa no tiene cert_path configurado".to_string()))?;

    let facturae_doc = build_facturae_doc(&invoice, &lines)?;

    let unsigned_xml = facturae_to_xml(&facturae_doc)?;
    let signed_or_unsigned = match sign_xml_xades(
        &unsigned_xml,
        &XadesSignInput {
            cert_path,
            cert_password,
        },
    ) {
        Ok(signed) => signed,
        Err(AppError::NotImplemented(_)) => unsigned_xml,
        Err(error) => return Err(error),
    };

    let output_dir = app
        .path()
        .resolve("Factelo/facturae", BaseDirectory::Document)
        .map_err(|error| {
            AppError::Internal(format!(
                "No se pudo resolver el directorio de salida de Facturae: {error}"
            ))
        })?;

    std::fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join(format!(
        "facturae_{}_{}_{}.xml",
        invoice.serie_prefijo,
        invoice.numero,
        invoice.fecha_emision.replace('-', "")
    ));
    std::fs::write(&output_path, signed_or_unsigned)?;

    Ok(output_path.to_string_lossy().to_string())
}

// ─── generar_facturae_autofirma ───────────────────────────────────────────────

#[tauri::command]
pub async fn generar_facturae_autofirma(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbPool>,
    factura_id: i64,
    empresa_id: i64,
) -> CommandResult<String> {
    generar_facturae_autofirma_internal(app, &state, factura_id, empresa_id)
        .await
        .map_err(ApiError::from)
}

async fn generar_facturae_autofirma_internal(
    app: tauri::AppHandle,
    db: &DbPool,
    factura_id: i64,
    empresa_id: i64,
) -> AppResult<String> {
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
            e.cert_path AS empresa_cert_path,
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

    // Guardar XML sin firmar en directorio temporal
    let temp_dir = std::env::temp_dir();
    let unsigned_path = temp_dir.join(format!("factelo_unsigned_{}.xml", factura_id));
    std::fs::write(&unsigned_path, &unsigned_xml)?;

    // Ruta de salida definitiva en Documentos/Factelo/facturae/
    let output_dir = app
        .path()
        .resolve("Factelo/facturae", BaseDirectory::Document)
        .map_err(|error| {
            AppError::Internal(format!(
                "No se pudo resolver el directorio de salida de Facturae: {error}"
            ))
        })?;
    std::fs::create_dir_all(&output_dir)?;
    let filename = format!(
        "facturae_{}_{}_{}_firmada.xml",
        invoice.serie_prefijo,
        invoice.numero,
        invoice.fecha_emision.replace('-', "")
    );
    let output_path = output_dir.join(&filename);

    // Buscar AutoFirma
    let autofirma_exe = find_autofirma_path().ok_or_else(|| {
        AppError::NotFound(
            "AutoFirma no está instalado. Descárgalo desde https://firmaelectronica.gob.es/Home/Descargas.html e instálalo para poder firmar facturas para entidades públicas.".to_string(),
        )
    })?;

    // Lanzar AutoFirma y esperar a que el usuario firme (operación bloqueante - abre GUI)
    let unsigned_path_str = unsigned_path.to_string_lossy().to_string();
    let output_path_str = output_path.to_string_lossy().to_string();

    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&autofirma_exe)
            .args([
                "sign",
                "-gui",           // abre diálogo gráfico para seleccionar certificado
                "-i",
                &unsigned_path_str,
                "-o",
                &output_path_str,
                "-format",
                "facturae",       // valor correcto (minúsculas)
                "-store",
                "windows",        // almacén de certificados de Windows
            ])
            .output()
    })
    .await
    .map_err(|join_err| AppError::Internal(format!("Error al esperar a AutoFirma: {join_err}")))?
    .map_err(|io_err| AppError::Internal(format!("No se pudo ejecutar AutoFirma: {io_err}")))?;

    // Limpiar fichero temporal
    let _ = std::fs::remove_file(&unsigned_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            "Sin detalle adicional (puede que el usuario cancelara la selección de certificado)"
                .to_string()
        };
        return Err(AppError::Internal(format!(
            "AutoFirma terminó con error. {detail}"
        )));
    }

    if !output_path.exists() {
        return Err(AppError::Internal(
            "AutoFirma no generó el fichero firmado. Puede que el usuario cancelara la operación."
                .to_string(),
        ));
    }

    Ok(output_path.to_string_lossy().to_string())
}

fn find_autofirma_path() -> Option<std::path::PathBuf> {
    // Primero intentamos el ejecutable de línea de comandos (no abre GUI completa)
    let candidates = [
        r"C:\Program Files\Autofirma\Autofirma\AutofirmaCommandLine.exe",
        r"C:\Program Files (x86)\Autofirma\Autofirma\AutofirmaCommandLine.exe",
        r"C:\Program Files\AutoFirma\AutoFirma\AutofirmaCommandLine.exe",
        r"C:\Program Files\Autofirma\Autofirma\Autofirma.exe",
        r"C:\Program Files (x86)\Autofirma\Autofirma\Autofirma.exe",
        r"C:\Program Files\AutoFirma\AutoFirma\AutoFirma.exe",
        r"C:\Program Files\AutoFirma\AutoFirma.exe",
        r"C:\Program Files (x86)\AutoFirma\AutoFirma.exe",
    ];
    candidates
        .iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.exists())
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
    pub cert_path: Option<String>,
}

#[tauri::command]
pub async fn obtener_empresas(state: tauri::State<'_, DbPool>) -> CommandResult<Vec<EmpresaRow>> {
    sqlx::query_as::<_, EmpresaRow>(
        "SELECT id, nombre, nif, direccion, cert_path FROM empresas ORDER BY id ASC",
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
        cert_path: None,
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
    pub nombre: String,
    pub nif: Option<String>,
    pub email: Option<String>,
    pub telefono: Option<String>,
    pub direccion: Option<String>,
    pub codigo_postal: Option<String>,
    pub poblacion: Option<String>,
    pub provincia: Option<String>,
    pub pais: String,
}

#[tauri::command]
pub async fn obtener_clientes(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
) -> CommandResult<Vec<ClienteRow>> {
    sqlx::query_as::<_, ClienteRow>(
        "SELECT id, empresa_id, nombre, nif, email, telefono, direccion, \
         codigo_postal, poblacion, provincia, pais \
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
    pub email: Option<String>,
    pub telefono: Option<String>,
    pub direccion: Option<String>,
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

    let id = sqlx::query(
        "INSERT INTO clientes (empresa_id, nombre, nif, email, telefono, direccion, pais, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ES', datetime('now'), datetime('now'))",
    )
    .bind(input.empresa_id)
    .bind(input.nombre.trim())
    .bind(input.nif.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .bind(input.email.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .bind(input.telefono.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .bind(input.direccion.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .execute(state.inner())
    .await
    .map_err(|e| ApiError::from(AppError::from(e)))?
    .last_insert_rowid();

    Ok(ClienteRow {
        id,
        empresa_id: input.empresa_id,
        nombre: input.nombre.trim().to_string(),
        nif: input.nif.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()),
        email: input.email.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()),
        telefono: input
            .telefono
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        direccion: input
            .direccion
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        codigo_postal: None,
        poblacion: None,
        provincia: None,
        pais: "ES".to_string(),
    })
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
            CAST(f.total AS INTEGER) AS total,
            CAST(f.total_impuestos AS INTEGER) AS total_impuestos,
            CAST(f.subtotal AS INTEGER) AS subtotal,
            f.estado,
            COALESCE(f.es_entidad_publica, 0) AS es_entidad_publica,
            f.hash_registro
        FROM facturas f
        JOIN clientes c ON c.id = f.cliente_id
        JOIN series_facturacion s ON s.id = f.serie_id
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
