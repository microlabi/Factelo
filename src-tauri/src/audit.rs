//! audit.rs — Registro de Facturación Inalterable (Veri*factu / Camino 2)
//!
//! Implementa:
//!  · calcular_hash_log    — SHA-256 encadenado para log_eventos_seguros
//!  · verificar_integridad_bd — recalcula y valida toda la cadena de hashes
//!  · generar_qr_legal     — QR técnico AEAT (Notariado) como SVG Base64
//!  · generar_fichero_inspeccion — XML auditado exportable para Hacienda

use chrono;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::{
    db::DbPool,
    error::{ApiError, AppError, AppResult, CommandResult},
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Calcula el SHA-256 encadenado de un evento de log.
/// Todos los campos se concatenan con `|` para el canonical antes de hashear.
pub fn calcular_hash_log(
    timestamp: &str,
    tipo_evento: &str,
    empresa_id: i64,
    factura_id: i64,
    numero_serie: &str,
    hash_factura: &str,
    hash_anterior: &str,
) -> String {
    let canonical = format!(
        "{timestamp}|{tipo_evento}|{empresa_id}|{factura_id}|{numero_serie}|{hash_factura}|{hash_anterior}"
    );
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

// ─── Resultado de verificación ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ResultadoIntegridad {
    pub integra: bool,
    pub total_eventos: i64,
    pub primer_evento: Option<String>,
    pub ultimo_evento: Option<String>,
    pub errores: Vec<String>,
}

// ─── Comando: verificar_integridad_bd ────────────────────────────────────────

/// Recorre toda la cadena de log_eventos_seguros para la empresa indicada
/// y valida cada hash_log recalculándolo desde los campos canonicalizados.
/// Si algún hash no coincide, o el encadenamiento está roto, devuelve
/// `integra: false` con la lista de anomalías.
#[tauri::command]
pub async fn verificar_integridad_bd(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
) -> CommandResult<ResultadoIntegridad> {
    verificar_integridad_interna(&state, empresa_id)
        .await
        .map_err(ApiError::from)
}

async fn verificar_integridad_interna(
    db: &DbPool,
    empresa_id: i64,
) -> AppResult<ResultadoIntegridad> {
    #[derive(sqlx::FromRow)]
    struct LogRow {
        id: i64,
        timestamp: String,
        tipo_evento: String,
        empresa_id: i64,
        factura_id: Option<i64>,
        numero_serie: String,
        hash_factura: String,
        hash_anterior: String,
        hash_log: String,
    }

    let rows: Vec<LogRow> = sqlx::query_as(
        r#"
        SELECT id, timestamp, tipo_evento, empresa_id, factura_id,
               numero_serie, hash_factura, hash_anterior, hash_log
        FROM log_eventos_seguros
        WHERE empresa_id = ?1
        ORDER BY id ASC
        "#,
    )
    .bind(empresa_id)
    .fetch_all(db)
    .await?;

    let total = rows.len() as i64;
    let primer = rows.first().map(|r| r.timestamp.clone());
    let ultimo = rows.last().map(|r| r.timestamp.clone());
    let mut errores = Vec::new();

    // Para verificar también que hash_factura coincide con lo almacenado en facturas
    for (i, row) in rows.iter().enumerate() {
        // 1. Recalcular hash_log
        let factura_id_val = row.factura_id.unwrap_or(0);
        let esperado = calcular_hash_log(
            &row.timestamp,
            &row.tipo_evento,
            row.empresa_id,
            factura_id_val,
            &row.numero_serie,
            &row.hash_factura,
            &row.hash_anterior,
        );
        if esperado != row.hash_log {
            errores.push(format!(
                "HASH_LOG_ALTERADO: evento id={} (fila {}). Esperado={} Encontrado={}",
                row.id,
                i + 1,
                &esperado[..16],
                &row.hash_log[..16]
            ));
        }

        // 2. Verificar encadenamiento con la fila anterior
        if i == 0 {
            if row.hash_anterior != "GENESIS" {
                errores.push(format!(
                    "GENESIS_ROTO: el primer evento (id={}) debería tener hash_anterior=GENESIS",
                    row.id
                ));
            }
        } else {
            let anterior_hash_log = &rows[i - 1].hash_log;
            if &row.hash_anterior != anterior_hash_log {
                errores.push(format!(
                    "CADENA_ROTA: evento id={} (fila {}). hash_anterior no coincide con hash_log del evento anterior.",
                    row.id,
                    i + 1
                ));
            }
        }

        // 3. Verificar que hash_factura existe en la tabla facturas
        if let Some(fid) = row.factura_id {
            let real_hash: Option<String> = sqlx::query(
                "SELECT hash_registro FROM facturas WHERE id = ?1 LIMIT 1",
            )
            .bind(fid)
            .fetch_optional(db)
            .await?
            .map(|r| r.get::<String, _>("hash_registro"));

            match real_hash {
                None => errores.push(format!(
                    "FACTURA_DESAPARECIDA: evento id={} referencia factura_id={} que ya no existe.",
                    row.id, fid
                )),
                Some(h) if h != row.hash_factura => errores.push(format!(
                    "HASH_FACTURA_ALTERADO: factura_id={} hash almacenado en log ({}) != hash en facturas ({})",
                    fid,
                    &row.hash_factura[..16],
                    &h[..16]
                )),
                _ => {}
            }
        }
    }

    Ok(ResultadoIntegridad {
        integra: errores.is_empty(),
        total_eventos: total,
        primer_evento: primer,
        ultimo_evento: ultimo,
        errores,
    })
}

// ─── Comando: generar_qr_legal ────────────────────────────────────────────────

/// Genera la imagen QR de verificación tributaria (AEAT Notariado) en formato
/// SVG codificado como Data URL (`data:image/svg+xml;base64,...`).
///
/// URL del QR (RD 1007/2023 Disposición adicional 3ª):
///   https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/v1/qr/notariado
///     ?nif=<NIF_EMISOR>
///     &numserie=<PREFIJO><NUMERO>
///     &fecha=<YYYY-MM-DD>
///     &importe=<TOTAL_EUROS_CON_2_DECIMALES>
///     &hash=<PRIMEROS_8_CHARS_SHA256_FACTURA>
#[tauri::command]
pub async fn generar_qr_legal(
    state: tauri::State<'_, DbPool>,
    factura_id: i64,
    empresa_id: i64,
) -> CommandResult<QrLegalResponse> {
    generar_qr_interno(&state, factura_id, empresa_id)
        .await
        .map_err(ApiError::from)
}

#[derive(Debug, Serialize)]
pub struct QrLegalResponse {
    /// SVG como Data URL lista para usar en <img src="...">
    pub svg_data_url: String,
    /// URL completa del QR (útil para mostrar al usuario)
    pub url: String,
}

async fn generar_qr_interno(
    db: &DbPool,
    factura_id: i64,
    empresa_id: i64,
) -> AppResult<QrLegalResponse> {
    // ── Obtener datos de la factura ──────────────────────────────────────────
    let row = sqlx::query(
        r#"
        SELECT
            f.fecha_emision,
            f.total,
            f.hash_registro,
            s.prefijo,
            f.numero,
            e.nif AS empresa_nif
        FROM facturas f
        JOIN series_facturacion s ON s.id = f.serie_id
        JOIN empresas e ON e.id = f.empresa_id
        WHERE f.id = ?1 AND f.empresa_id = ?2
        LIMIT 1
        "#,
    )
    .bind(factura_id)
    .bind(empresa_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Factura {factura_id} no encontrada")))?;

    let nif: String = row.get("empresa_nif");
    let prefijo: String = row.get("prefijo");
    let numero: i64 = row.get("numero");
    let fecha: String = row.get("fecha_emision");
    let total_centimos: i64 = row.get("total");
    let hash_reg: String = row.get("hash_registro");

    // Importe en euros con 2 decimales (el total se guarda en céntimos)
    let importe = format!("{:.2}", total_centimos as f64 / 100.0);
    let numserie = format!("{}{:04}", prefijo, numero);
    // El hash para el QR son los primeros 8 caracteres hexadecimales del SHA-256
    let hash_corto = &hash_reg[..hash_reg.len().min(8)];

    let url = format!(
        "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/v1/qr/notariado\
         ?nif={nif}&numserie={numserie}&fecha={fecha}&importe={importe}&hash={hash_corto}"
    );

    // ── Generar QR como PNG ──────────────────────────────────────────────────
    let svg_data_url = qr_to_png_data_url(&url)?;

    Ok(QrLegalResponse { svg_data_url, url })
}

/// Genera el código QR como imagen PNG y lo devuelve como Data URL
/// (`data:image/png;base64,...`), lista para usar en `<img src="...">` y
/// en plantillas HTML sin problemas de compatibilidad con WebView.
pub fn qr_to_png_data_url(data: &str) -> AppResult<String> {
    use qrcodegen::{QrCode, QrCodeEcc};
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use image::{GrayImage, Luma};

    let qr = QrCode::encode_text(data, QrCodeEcc::Medium)
        .map_err(|e| AppError::Internal(format!("Error generando QR: {e:?}")))?;

    let size = qr.size() as u32;
    let border = 4u32;  // módulos de margen blanco
    let scale = 8u32;   // píxeles por módulo
    let total = (size + border * 2) * scale;

    let mut img = GrayImage::new(total, total);
    // Rellenar con blanco
    for pixel in img.pixels_mut() {
        *pixel = Luma([255u8]);
    }
    // Dibujar módulos negros
    for y in 0..qr.size() {
        for x in 0..qr.size() {
            if qr.get_module(x, y) {
                let ox = (border + x as u32) * scale;
                let oy = (border + y as u32) * scale;
                for dy in 0..scale {
                    for dx in 0..scale {
                        img.put_pixel(ox + dx, oy + dy, Luma([0u8]));
                    }
                }
            }
        }
    }

    let dyn_img = image::DynamicImage::from(img);
    let mut png_bytes: Vec<u8> = Vec::new();
    dyn_img
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| AppError::Internal(format!("Error codificando QR a PNG: {e}")))?;

    Ok(format!("data:image/png;base64,{}", B64.encode(&png_bytes)))
}

/// Genera un SVG con el módulo QR codificado.
/// Usa la crate `qrcodegen` que es pure-Rust sin dependencias de imagen.
pub fn qr_to_svg(data: &str) -> AppResult<String> {
    use qrcodegen::{QrCode, QrCodeEcc};

    let qr = QrCode::encode_text(data, QrCodeEcc::Medium)
        .map_err(|e| AppError::Internal(format!("Error generando QR: {e:?}")))?;

    let size = qr.size();
    let border = 4; // módulos de margen
    let total = (size + border * 2) as u32;
    let module_px = 4u32; // px por módulo

    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" version="1.1" \
viewBox="0 0 {dim} {dim}" shape-rendering="crispEdges">"#,
        dim = total * module_px
    );
    svg.push_str(&format!(
        r#"<rect width="{dim}" height="{dim}" fill="white"/>"#,
        dim = total * module_px
    ));

    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x, y) {
                let px = ((x as u32) + border as u32) * module_px;
                let py = ((y as u32) + border as u32) * module_px;
                svg.push_str(&format!(
                    r#"<rect x="{px}" y="{py}" width="{module_px}" height="{module_px}" fill="black"/>"#,
                ));
            }
        }
    }
    svg.push_str("</svg>");
    Ok(svg)
}

// ─── Comando: generar_fichero_inspeccion ─────────────────────────────────────

/// Exporta un fichero XML firmado con toda la cadena de eventos del año
/// indicado, apto para ser presentado a un inspector de Hacienda.
/// El archivo se guarda en la carpeta de datos de la aplicación.
#[tauri::command]
pub async fn generar_fichero_inspeccion(
    state: tauri::State<'_, DbPool>,
    empresa_id: i64,
    anio: i32,
) -> CommandResult<FicheroInspeccionResponse> {
    generar_fichero_interno(&state, empresa_id, anio)
        .await
        .map_err(ApiError::from)
}

#[derive(Debug, Serialize)]
pub struct FicheroInspeccionResponse {
    /// Ruta donde se guardó el fichero XML
    pub ruta: String,
    /// Número de eventos incluidos
    pub total_eventos: usize,
}

async fn generar_fichero_interno(
    db: &DbPool,
    empresa_id: i64,
    anio: i32,
) -> AppResult<FicheroInspeccionResponse> {
    // ── Metadatos de la empresa ──────────────────────────────────────────────
    let empresa = sqlx::query(
        "SELECT nombre, nif FROM empresas WHERE id = ?1 LIMIT 1",
    )
    .bind(empresa_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Empresa {empresa_id} no encontrada")))?;

    let empresa_nombre: String = empresa.get("nombre");
    let empresa_nif: String = empresa.get("nif");

    // ── Obtener eventos del año ──────────────────────────────────────────────
    #[derive(Serialize)]
    struct EventoXml {
        id: i64,
        timestamp: String,
        tipo_evento: String,
        numero_serie: String,
        hash_factura: String,
        hash_anterior: String,
        hash_log: String,
        factura_id: Option<i64>,
    }

    let anio_desde = format!("{anio}-01-01T00:00:00.000Z");
    let anio_hasta = format!("{}-01-01T00:00:00.000Z", anio + 1);

    let rows = sqlx::query(
        r#"
        SELECT id, timestamp, tipo_evento, numero_serie,
               hash_factura, hash_anterior, hash_log, factura_id
        FROM log_eventos_seguros
        WHERE empresa_id = ?1
          AND timestamp >= ?2
          AND timestamp <  ?3
        ORDER BY id ASC
        "#,
    )
    .bind(empresa_id)
    .bind(&anio_desde)
    .bind(&anio_hasta)
    .fetch_all(db)
    .await?;

    let eventos: Vec<EventoXml> = rows
        .iter()
        .map(|r| EventoXml {
            id: r.get("id"),
            timestamp: r.get("timestamp"),
            tipo_evento: r.get("tipo_evento"),
            numero_serie: r.get("numero_serie"),
            hash_factura: r.get("hash_factura"),
            hash_anterior: r.get("hash_anterior"),
            hash_log: r.get("hash_log"),
            factura_id: r.get("factura_id"),
        })
        .collect();

    let total = eventos.len();

    // ── Verificar integridad antes de exportar ───────────────────────────────
    let integridad = verificar_integridad_interna(db, empresa_id).await?;
    let estado_integridad = if integridad.integra {
        "ÍNTEGRA"
    } else {
        "COMPROMETIDA"
    };

    // ── Construir XML ────────────────────────────────────────────────────────
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let hash_fichero = {
        let mut hasher = Sha256::new();
        for e in &eventos {
            hasher.update(e.hash_log.as_bytes());
        }
        hex::encode(hasher.finalize())
    };

    let mut xml = String::new();
    xml.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    xml.push('\n');
    xml.push_str(
        r#"<!-- Fichero de Inspección Tributaria - Registro de Facturación Inalterable -->"#,
    );
    xml.push('\n');
    xml.push_str(r#"<!-- Generado cumpliendo RD 1007/2023 (Veri*factu) / Ley 8/2022 Crea y Crece -->"#);
    xml.push('\n');
    xml.push_str("<RegistroFacturacion>\n");
    xml.push_str(&format!("  <Cabecera>\n"));
    xml.push_str(&format!("    <NombreEmisor>{}</NombreEmisor>\n", escape_xml(&empresa_nombre)));
    xml.push_str(&format!("    <NifEmisor>{}</NifEmisor>\n", escape_xml(&empresa_nif)));
    xml.push_str(&format!("    <EjercicioFiscal>{anio}</EjercicioFiscal>\n"));
    xml.push_str(&format!("    <FechaGeneracion>{now}</FechaGeneracion>\n"));
    xml.push_str(&format!("    <TotalEventos>{total}</TotalEventos>\n"));
    xml.push_str(&format!("    <EstadoIntegridad>{estado_integridad}</EstadoIntegridad>\n"));
    xml.push_str(&format!("    <HashFichero>{hash_fichero}</HashFichero>\n"));
    xml.push_str(&format!("    <SistemaGenerador>Factelo v{}</SistemaGenerador>\n", env!("CARGO_PKG_VERSION")));
    xml.push_str("  </Cabecera>\n");
    xml.push_str("  <LogEventos>\n");

    for evento in &eventos {
        xml.push_str("    <Evento>\n");
        xml.push_str(&format!("      <Id>{}</Id>\n", evento.id));
        xml.push_str(&format!("      <Timestamp>{}</Timestamp>\n", evento.timestamp));
        xml.push_str(&format!("      <TipoEvento>{}</TipoEvento>\n", evento.tipo_evento));
        xml.push_str(&format!("      <NumeroSerie>{}</NumeroSerie>\n", escape_xml(&evento.numero_serie)));
        if let Some(fid) = evento.factura_id {
            xml.push_str(&format!("      <FacturaId>{fid}</FacturaId>\n"));
        }
        xml.push_str(&format!("      <HashFactura>{}</HashFactura>\n", evento.hash_factura));
        xml.push_str(&format!("      <HashAnterior>{}</HashAnterior>\n", evento.hash_anterior));
        xml.push_str(&format!("      <HashLog>{}</HashLog>\n", evento.hash_log));
        xml.push_str("    </Evento>\n");
    }
    xml.push_str("  </LogEventos>\n");

    // Incluir anomalías si las hay
    if !integridad.errores.is_empty() {
        xml.push_str("  <Anomalias>\n");
        for err in &integridad.errores {
            xml.push_str(&format!("    <Anomalia>{}</Anomalia>\n", escape_xml(err)));
        }
        xml.push_str("  </Anomalias>\n");
    }

    xml.push_str("</RegistroFacturacion>\n");

    // ── Guardar fichero ──────────────────────────────────────────────────────
    let filename = format!(
        "inspeccion_{}_{}_{}_{}.xml",
        escape_filename(&empresa_nif),
        anio,
        chrono::Utc::now().format("%Y%m%d%H%M%S"),
        &hash_fichero[..8]
    );

    // Guardar junto a la base de datos (AppLocalData)
    let base_dir = dirs_next::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("factelo")
        .join("inspecciones");

    tokio::fs::create_dir_all(&base_dir).await?;

    let ruta = base_dir.join(&filename);
    tokio::fs::write(&ruta, xml.as_bytes()).await?;

    Ok(FicheroInspeccionResponse {
        ruta: ruta.to_string_lossy().to_string(),
        total_eventos: total,
    })
}

// ─── Utilidades XML ──────────────────────────────────────────────────────────

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn escape_filename(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}
