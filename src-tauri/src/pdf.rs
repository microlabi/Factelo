use std::{fs, path::PathBuf};

use headless_chrome::{types::PrintToPdfOptions, Browser, LaunchOptionsBuilder};
use serde::Serialize;
use sqlx::FromRow;
use tauri::{path::BaseDirectory, Manager};
use tera::{Context, Tera};
use url::Url;


use crate::{
    db::DbPool,
    error::{ApiError, AppError, AppResult, CommandResult},
};

const INVOICE_TEMPLATE: &str = include_str!("../templates/invoice.html");

#[derive(Debug, FromRow)]
struct InvoiceRow {
    numero: i64,
    fecha_emision: String,
    #[allow(dead_code)] // almacenado en BD pero los totales se recalculan desde las líneas
    subtotal: i64,
    #[allow(dead_code)]
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
struct IvaGroupTemplateData {
    rate: String,   // p.ej. "21%"
    base: String,   // base imponible formateada
    cuota: String,  // cuota IVA formateada
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
    iva_groups: Vec<IvaGroupTemplateData>,
    hash_registro: String,
    hash_anterior: String,
    items: Vec<InvoiceItemTemplateData>,
    /// PNG del QR de verificación AEAT como Data URL (puede estar vacío si falla)
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
    // Recalcular el total desde las líneas por si invoice.total está a 0
    // (facturas creadas con versiones anteriores del frontend).
    let total_real: i64 = if invoice.total > 0 {
        invoice.total
    } else {
        lines.iter().map(|l| {
            let base = (l.cantidad * l.precio_unitario as f64).round() as i64;
            let cuota = (base as f64 * l.tipo_iva / 100.0).round() as i64;
            base + cuota
        }).sum()
    };
    let importe = format!("{:.2}", total_real as f64 / 100.0);
    let numserie = format!("{}{:04}", invoice.serie_prefijo, invoice.numero);
    let hash_corto = &invoice.hash_registro[..invoice.hash_registro.len().min(8)];
    let qr_url = format!(
        "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/v1/qr/notariado\
         ?nif={nif}&numserie={numserie}&fecha={fecha}&importe={importe}&hash={hash_corto}",
        nif = invoice.empresa_nif,
        fecha = invoice.fecha_emision,
    );
    let qr_svg_data_url = match crate::audit::qr_to_png_data_url(&qr_url) {
        Ok(data_url) => data_url,
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

    // ── Recalcular totales desde las líneas ──────────────────────────────────
    // No usamos invoice.subtotal / invoice.total_impuestos porque podrían
    // haberse guardado a 0 si la factura fue creada con una versión anterior.
    use std::collections::BTreeMap;
    let mut subtotal_cents: i64 = 0;
    let mut iva_map: BTreeMap<i32, (i64, i64)> = BTreeMap::new(); // key=rate*100 → (base, cuota)

    for line in lines {
        let base = (line.cantidad * line.precio_unitario as f64).round() as i64;
        let cuota = (base as f64 * line.tipo_iva / 100.0).round() as i64;
        let rate_key = (line.tipo_iva * 100.0).round() as i32;
        subtotal_cents += base;
        let entry = iva_map.entry(rate_key).or_insert((0_i64, 0_i64));
        entry.0 += base;
        entry.1 += cuota;
    }

    let total_iva_cents: i64 = iva_map.values().map(|(_, cuota)| cuota).sum();
    let total_cents = subtotal_cents + total_iva_cents;

    // IVA groups ordenados de mayor a menor tipo (21% → 10% → 4% → 0%)
    let iva_groups: Vec<IvaGroupTemplateData> = iva_map
        .into_iter()
        .rev()
        .filter(|(_, (base, cuota))| *base != 0 || *cuota != 0)
        .map(|(rate_key, (base, cuota))| IvaGroupTemplateData {
            rate: format!("{:.0}%", rate_key as f64 / 100.0),
            base: format_currency(base),
            cuota: format_currency(cuota),
        })
        .collect();

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
        subtotal: format_currency(subtotal_cents),
        total_taxes: format_currency(total_iva_cents),
        total: format_currency(total_cents),
        iva_groups,
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
        // ── Localizar Chrome/Edge del sistema ────────────────────────────────
        // headless_chrome sin path explícito intenta descargar Chromium, lo que
        // cuelga indefinidamente. Usamos el navegador instalado en el sistema.
        let browser_path = find_system_browser().ok_or_else(|| {
            AppError::Internal(
                "No se encontró Google Chrome ni Microsoft Edge instalados. \
                 Por favor instala alguno de ellos para poder generar PDFs."
                    .to_string(),
            )
        })?;

        let options = LaunchOptionsBuilder::default()
            .path(Some(browser_path))
            .headless(true)
            .sandbox(false) // necesario en Tauri/Windows para evitar bloqueos
            .idle_browser_timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|error| {
                AppError::Internal(format!(
                    "No se pudo crear configuración de navegador headless: {error}"
                ))
            })?;

        let browser = Browser::new(options).map_err(|error| {
            AppError::Internal(format!(
                "No se pudo iniciar el navegador headless para generar PDF: {error}"
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

/// Busca un navegador Chromium instalado en el sistema por orden de preferencia:
/// Chrome (estable) → Chrome Beta → Chrome Dev → MSEdge.
/// Devuelve `None` si no encuentra ninguno.
fn find_system_browser() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\Google\Chrome Beta\Application\chrome.exe",
            r"C:\Program Files\Google\Chrome Dev\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ];
        for path in candidates {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
        // También buscar en LocalAppData del usuario
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let user_candidates = [
                format!(r"{local_app_data}\Google\Chrome\Application\chrome.exe"),
                format!(r"{local_app_data}\Microsoft\Edge\Application\msedge.exe"),
            ];
            for path in &user_candidates {
                let p = std::path::PathBuf::from(path);
                if p.exists() {
                    return Some(p);
                }
            }
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
        for path in candidates {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
        None
    }
    #[cfg(target_os = "linux")]
    {
        let candidates = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
        ];
        for path in candidates {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
        None
    }
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
