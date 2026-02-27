use std::{fs, path::PathBuf};

use headless_chrome::{types::PrintToPdfOptions, Browser, LaunchOptionsBuilder};
use serde::Serialize;
use sqlx::FromRow;
use tauri::{path::BaseDirectory, Manager};
use tera::{Context, Tera};
use url::Url;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

use crate::{
    db::DbPool,
    error::{ApiError, AppError, AppResult, CommandResult},
};

const INVOICE_TEMPLATE: &str = include_str!("../templates/invoice.html");

#[derive(Debug, FromRow)]
struct InvoiceRow {
    numero: i64,
    fecha_emision: String,
    subtotal: i64,
    total_impuestos: i64,
    total: i64,
    hash_registro: String,
    hash_anterior: Option<String>,
    estado: String,
    serie_prefijo: String,
    empresa_nombre: String,
    empresa_nif: String,
    empresa_direccion: String,
    cliente_nombre: String,
    cliente_nif: Option<String>,
    cliente_direccion: Option<String>,
    cliente_email: Option<String>,
}

#[derive(Debug, FromRow)]
struct InvoiceLineRow {
    descripcion: String,
    cantidad: f64,
    precio_unitario: i64,
    tipo_iva: f64,
    total_linea: i64,
}

#[derive(Debug, Serialize)]
struct InvoiceTemplateData {
    generated_at: String,
    invoice_code: String,
    issue_date: String,
    company_name: String,
    company_nif: String,
    company_address: String,
    client_name: String,
    client_nif: String,
    client_address: String,
    client_email: String,
    status: String,
    subtotal: String,
    total_taxes: String,
    total: String,
    hash_registro: String,
    hash_anterior: String,
    items: Vec<InvoiceItemTemplateData>,
    /// SVG del QR de verificación AEAT como Data URL (puede estar vacío si falla)
    qr_svg_data_url: String,
    /// URL completa del QR de notariado AEAT
    qr_url: String,
}

#[derive(Debug, Serialize)]
struct InvoiceItemTemplateData {
    descripcion: String,
    cantidad: String,
    precio_unitario: String,
    tipo_iva: String,
    total_linea: String,
}

#[tauri::command]
pub async fn generate_pdf(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbPool>,
    factura_id: i32,
    _empresa_id: Option<i64>,
) -> CommandResult<String> {
    generate_pdf_internal(app, &state, factura_id)
        .await
        .map_err(ApiError::from)
}

async fn generate_pdf_internal(
    app: tauri::AppHandle,
    db: &DbPool,
    factura_id: i32,
) -> AppResult<String> {
    if factura_id <= 0 {
        return Err(AppError::Validation(
            "factura_id debe ser mayor que cero".to_string(),
        ));
    }

    let invoice = fetch_invoice(db, factura_id as i64).await?;
    let lines = fetch_invoice_lines(db, factura_id as i64).await?;

    if lines.is_empty() {
        return Err(AppError::Validation(
            "La factura no contiene líneas para generar el PDF".to_string(),
        ));
    }

    // ── QR de verificación tributaria AEAT (RD 1007/2023) ─────────────────
    let importe = format!("{:.2}", invoice.total as f64 / 100.0);
    let numserie = format!("{}{:04}", invoice.serie_prefijo, invoice.numero);
    let hash_corto = &invoice.hash_registro[..invoice.hash_registro.len().min(8)];
    let qr_url = format!(
        "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/v1/qr/notariado\
         ?nif={nif}&numserie={numserie}&fecha={fecha}&importe={importe}&hash={hash_corto}",
        nif = invoice.empresa_nif,
        fecha = invoice.fecha_emision,
    );
    let qr_svg_data_url = match crate::audit::qr_to_svg(&qr_url) {
        Ok(svg) => format!("data:image/svg+xml;base64,{}", B64.encode(svg.as_bytes())),
        Err(_) => String::new(),
    };

    let html = render_invoice_html(&invoice, &lines, &qr_svg_data_url, &qr_url)?;
    let output_path = resolve_output_path(&app, &invoice)?;

    let output_path_for_job = output_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        render_html_to_pdf(&html, &output_path_for_job)
    })
    .await
    .map_err(|error| AppError::Internal(format!("Error en tarea de generación PDF: {error}")))??;

    Ok(output_path.to_string_lossy().to_string())
}

async fn fetch_invoice(db: &DbPool, factura_id: i64) -> AppResult<InvoiceRow> {
    let row = sqlx::query_as::<_, InvoiceRow>(
        r#"
        SELECT
            f.numero,
            f.fecha_emision,
            CAST(f.subtotal AS INTEGER) AS subtotal,
            CAST(f.total_impuestos AS INTEGER) AS total_impuestos,
            CAST(f.total AS INTEGER) AS total,
            f.hash_registro,
            f.hash_anterior,
            f.estado,
            s.prefijo AS serie_prefijo,
            e.nombre AS empresa_nombre,
            e.nif AS empresa_nif,
            e.direccion AS empresa_direccion,
            c.nombre AS cliente_nombre,
            c.nif AS cliente_nif,
            c.direccion AS cliente_direccion,
            c.email AS cliente_email
        FROM facturas f
        INNER JOIN empresas e ON e.id = f.empresa_id
        INNER JOIN clientes c ON c.id = f.cliente_id
        INNER JOIN series_facturacion s ON s.id = f.serie_id
        WHERE f.id = ?1
        LIMIT 1
        "#,
    )
    .bind(factura_id)
    .fetch_optional(db)
    .await?;

    row.ok_or_else(|| AppError::NotFound(format!("No existe la factura con id {factura_id}")))
}

async fn fetch_invoice_lines(db: &DbPool, factura_id: i64) -> AppResult<Vec<InvoiceLineRow>> {
    let rows = sqlx::query_as::<_, InvoiceLineRow>(
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

    Ok(rows)
}

fn render_invoice_html(
    invoice: &InvoiceRow,
    lines: &[InvoiceLineRow],
    qr_svg_data_url: &str,
    qr_url: &str,
) -> AppResult<String> {
    let items = lines
        .iter()
        .map(|line| InvoiceItemTemplateData {
            descripcion: line.descripcion.clone(),
            cantidad: format_decimal(line.cantidad),
            precio_unitario: format_currency(line.precio_unitario),
            tipo_iva: format_percentage(line.tipo_iva),
            total_linea: format_currency(line.total_linea),
        })
        .collect::<Vec<_>>();

    let template_data = InvoiceTemplateData {
        generated_at: current_timestamp_string(),
        invoice_code: format!("{}-{:04}", invoice.serie_prefijo, invoice.numero),
        issue_date: invoice.fecha_emision.clone(),
        company_name: invoice.empresa_nombre.clone(),
        company_nif: invoice.empresa_nif.clone(),
        company_address: invoice.empresa_direccion.clone(),
        client_name: invoice.cliente_nombre.clone(),
        client_nif: invoice.cliente_nif.clone().unwrap_or_else(|| "-".to_string()),
        client_address: invoice
            .cliente_direccion
            .clone()
            .unwrap_or_else(|| "-".to_string()),
        client_email: invoice
            .cliente_email
            .clone()
            .unwrap_or_else(|| "-".to_string()),
        status: invoice.estado.clone(),
        subtotal: format_currency(invoice.subtotal),
        total_taxes: format_currency(invoice.total_impuestos),
        total: format_currency(invoice.total),
        hash_registro: invoice.hash_registro.clone(),
        hash_anterior: invoice
            .hash_anterior
            .clone()
            .unwrap_or_else(|| "GENESIS".to_string()),
        items,
        qr_svg_data_url: qr_svg_data_url.to_string(),
        qr_url: qr_url.to_string(),
    };

    let mut context = Context::new();
    context.insert("invoice", &template_data);

    Tera::one_off(INVOICE_TEMPLATE, &context, false)
        .map_err(|error| AppError::Internal(format!("Error al renderizar plantilla de factura: {error}")))
}

fn resolve_output_path(app: &tauri::AppHandle, invoice: &InvoiceRow) -> AppResult<PathBuf> {
    let output_dir = app
        .path()
        .resolve("Factelo/facturas", BaseDirectory::Document)
        .map_err(|error| {
            AppError::Internal(format!(
                "No se pudo resolver el directorio de documentos del usuario: {error}"
            ))
        })?;

    fs::create_dir_all(&output_dir)?;

    let prefix = sanitize_filename_segment(&invoice.serie_prefijo);
    let date = sanitize_filename_segment(&invoice.fecha_emision.replace('-', ""));
    let file_name = format!("factura_{}_{}_{}.pdf", prefix, invoice.numero, date);

    Ok(output_dir.join(file_name))
}

fn render_html_to_pdf(html: &str, output_path: &PathBuf) -> AppResult<()> {
    let temp_html_path = std::env::temp_dir().join(format!(
        "factelo_invoice_{}_{}.html",
        std::process::id(),
        current_timestamp_filename_segment()
    ));

    fs::write(&temp_html_path, html)?;

    let render_result = (|| -> AppResult<()> {
        let options = LaunchOptionsBuilder::default()
            .headless(true)
            .build()
            .map_err(|error| {
                AppError::Internal(format!(
                    "No se pudo crear configuración de navegador headless: {error}"
                ))
            })?;

        let browser = Browser::new(options).map_err(|error| {
            AppError::Internal(format!(
                "No se pudo iniciar Chromium headless para generar PDF: {error}"
            ))
        })?;

        let tab = browser.new_tab().map_err(|error| {
            AppError::Internal(format!("No se pudo abrir pestaña de renderizado: {error}"))
        })?;

        let file_url = Url::from_file_path(&temp_html_path).map_err(|_| {
            AppError::Internal("No se pudo convertir la ruta HTML temporal a URL".to_string())
        })?;

        tab.navigate_to(file_url.as_str()).map_err(|error| {
            AppError::Internal(format!("No se pudo cargar el HTML de la factura: {error}"))
        })?;

        tab.wait_until_navigated().map_err(|error| {
            AppError::Internal(format!(
                "No se completó la navegación del HTML para PDF: {error}"
            ))
        })?;

        let pdf_data = tab
            .print_to_pdf(Some(PrintToPdfOptions {
                print_background: Some(true),
                paper_width: Some(8.27),
                paper_height: Some(11.69),
                margin_top: Some(0.35),
                margin_bottom: Some(0.35),
                margin_left: Some(0.35),
                margin_right: Some(0.35),
                prefer_css_page_size: Some(true),
                ..Default::default()
            }))
            .map_err(|error| {
                AppError::Internal(format!("No se pudo renderizar el PDF desde HTML: {error}"))
            })?;

        fs::write(output_path, pdf_data)?;
        Ok(())
    })();

    let _ = fs::remove_file(&temp_html_path);
    render_result
}

fn format_currency(cents: i64) -> String {
    let value = cents as f64 / 100.0;
    let normalized = format!("{value:.2}");
    format!("{} €", normalized.replace('.', ","))
}

fn format_decimal(value: f64) -> String {
    format!("{value:.2}").replace('.', ",")
}

fn format_percentage(value: f64) -> String {
    format!("{value:.2}").replace('.', ",") + "%"
}

fn current_timestamp_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("{}", duration.as_secs()),
        Err(_) => "0".to_string(),
    }
}

fn current_timestamp_filename_segment() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn sanitize_filename_segment(input: &str) -> String {
    let mut clean = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();

    if clean.is_empty() {
        clean = "valor".to_string();
    }

    clean
}

/// Abre un archivo con la aplicación predeterminada del sistema operativo.
/// En Windows usa `start`, en macOS `open`, en Linux `xdg-open`.
#[tauri::command]
pub async fn abrir_archivo(ruta: String) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .arg("/c")
            .arg("start")
            .arg("")
            .arg(&ruta)
            .spawn()
            .map_err(|e| ApiError::from(AppError::Internal(format!("No se pudo abrir el archivo: {e}"))))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&ruta)
            .spawn()
            .map_err(|e| ApiError::from(AppError::Internal(format!("No se pudo abrir el archivo: {e}"))))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&ruta)
            .spawn()
            .map_err(|e| ApiError::from(AppError::Internal(format!("No se pudo abrir el archivo: {e}"))))?;
    }
    Ok(())
}
