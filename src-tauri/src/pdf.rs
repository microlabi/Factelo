use std::{fs, path::PathBuf};

use headless_chrome::{types::PrintToPdfOptions, Browser, LaunchOptionsBuilder};
use serde::{Deserialize, Serialize};
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
    empresa_codigo_postal: Option<String>,
    empresa_poblacion: Option<String>,
    empresa_provincia: Option<String>,
    cliente_nombre: String,
    cliente_nif: Option<String>,
    cliente_direccion: Option<String>,
    cliente_codigo_postal: Option<String>,
    cliente_poblacion: Option<String>,
    cliente_provincia: Option<String>,
    cliente_email: Option<String>,
    // Condiciones de pago y observaciones
    notas: Option<String>,
    fecha_vencimiento: Option<String>,
    metodo_pago: Option<String>,
    cuenta_bancaria: Option<String>,
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
    due_date: String,
    company_name: String,
    company_nif: String,
    company_address: String,
    company_postal_city: String,
    company_province: String,
    client_name: String,
    client_nif: String,
    client_address: String,
    client_postal_city: String,
    client_province: String,
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
    /// Método de pago (etiqueta legible)
    payment_method: String,
    /// IBAN / cuenta bancaria
    bank_account: String,
    /// Observaciones / notas del pie
    notes: String,
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
            e.codigo_postal AS empresa_codigo_postal,
            e.poblacion AS empresa_poblacion,
            e.provincia AS empresa_provincia,
            c.nombre AS cliente_nombre,
            c.nif AS cliente_nif,
            c.direccion AS cliente_direccion,
            c.codigo_postal AS cliente_codigo_postal,
            c.poblacion AS cliente_poblacion,
            c.provincia AS cliente_provincia,
            c.email AS cliente_email,
            f.notas,
            f.fecha_vencimiento,
            f.metodo_pago,
            f.cuenta_bancaria
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
        due_date: invoice.fecha_vencimiento.clone().unwrap_or_default(),
        company_name: invoice.empresa_nombre.clone(),
        company_nif: invoice.empresa_nif.clone(),
        company_address: invoice.empresa_direccion.clone(),
        company_postal_city: format_postal_city(
            invoice.empresa_codigo_postal.as_deref(),
            invoice.empresa_poblacion.as_deref(),
        ),
        company_province: invoice.empresa_provincia.clone().unwrap_or_default(),
        client_name: invoice.cliente_nombre.clone(),
        client_nif: invoice.cliente_nif.clone().unwrap_or_else(|| "-".to_string()),
        client_address: invoice
            .cliente_direccion
            .clone()
            .unwrap_or_else(|| "-".to_string()),
        client_postal_city: format_postal_city(
            invoice.cliente_codigo_postal.as_deref(),
            invoice.cliente_poblacion.as_deref(),
        ),
        client_province: invoice.cliente_provincia.clone().unwrap_or_default(),
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
        payment_method: label_for_metodo_pago(invoice.metodo_pago.as_deref()),
        bank_account: invoice.cuenta_bancaria.clone().unwrap_or_default(),
        notes: invoice.notas.clone().unwrap_or_default(),
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

/// Formatea CP + población en una sola cadena (p.ej. "28001 Madrid").
fn format_postal_city(cp: Option<&str>, poblacion: Option<&str>) -> String {
    match (cp, poblacion) {
        (Some(cp), Some(p)) if !cp.is_empty() && !p.is_empty() => format!("{cp} {p}"),
        (None, Some(p)) | (Some(_), Some(p)) => p.to_string(),
        (Some(cp), None) => cp.to_string(),
        _ => String::new(),
    }
}

/// Devuelve la etiqueta legible de un método de pago.
fn label_for_metodo_pago(value: Option<&str>) -> String {
    match value {
        Some("transferencia") => "Transferencia bancaria".to_string(),
        Some("efectivo") => "Efectivo".to_string(),
        Some("tarjeta") => "Tarjeta".to_string(),
        Some("recibo_domiciliado") => "Recibo domiciliado".to_string(),
        Some(other) if !other.is_empty() => other.to_string(),
        _ => String::new(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Informe Ejecutivo PDF — Estadísticas Avanzadas
// ─────────────────────────────────────────────────────────────────────────────

const ADVANCED_STATS_TEMPLATE: &str =
    include_str!("../templates/advanced_stats_report.html");

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AbcClientePdf {
    pub cliente_nombre: String,
    pub total_facturado: i64,
    pub porcentaje_sobre_total: f64,
    pub porcentaje_acumulado: f64,
    pub clase_abc: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DsoClientePdf {
    pub cliente_nombre: String,
    pub total_facturado: i64,
    pub retraso_medio_dias: f64,
    pub riesgo: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct HeatmapCeldaPdf {
    pub anio_mes: String,
    pub concepto: String,
    pub total_facturado: i64,
}

#[derive(Debug, Deserialize)]
pub struct AdvancedStatsPdfInput {
    pub empresa_id: i64,
    pub empresa_nombre: String,
    pub abc: Vec<AbcClientePdf>,
    pub dso: Vec<DsoClientePdf>,
    pub heatmap: Vec<HeatmapCeldaPdf>,
}

// ── Template data structs (Tera) ──────────────────────────────────────────

#[derive(Debug, Serialize)]
struct AbcRowTpl {
    cliente_nombre: String,
    total_facturado_fmt: String,
    porcentaje_sobre_total: f64,
    porcentaje_acumulado: f64,
    clase_abc: String,
    bar_pct: f64,
}

#[derive(Debug, Serialize)]
struct DsoRowTpl {
    cliente_nombre: String,
    total_facturado_fmt: String,
    retraso_medio_dias: f64,
    riesgo: String,
}

#[derive(Debug, Serialize)]
struct HeatmapCeldaTpl {
    nivel: u8,
    valor: i64,
    valor_fmt: String,
}

#[derive(Debug, Serialize)]
struct HeatmapFilaTpl {
    concepto: String,
    celdas: Vec<HeatmapCeldaTpl>,
}

#[tauri::command]
pub async fn generate_advanced_stats_pdf(
    app: tauri::AppHandle,
    input: AdvancedStatsPdfInput,
) -> CommandResult<String> {
    generate_advanced_stats_pdf_internal(app, input)
        .await
        .map_err(ApiError::from)
}

async fn generate_advanced_stats_pdf_internal(
    app: tauri::AppHandle,
    input: AdvancedStatsPdfInput,
) -> AppResult<String> {
    let html = render_advanced_stats_html(&input)?;

    let output_dir = app
        .path()
        .resolve("Factelo/informes", BaseDirectory::Document)
        .map_err(|e| {
            AppError::Internal(format!(
                "No se pudo resolver el directorio de documentos: {e}"
            ))
        })?;
    fs::create_dir_all(&output_dir)?;

    let ts = current_timestamp_filename_segment();
    let file_name = format!("informe_estadistico_{ts}.pdf");
    let output_path = output_dir.join(file_name);
    let output_path_for_job = output_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        render_html_to_pdf(&html, &output_path_for_job)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Error en tarea de generación PDF: {e}")))??;

    Ok(output_path.to_string_lossy().to_string())
}

fn render_advanced_stats_html(input: &AdvancedStatsPdfInput) -> AppResult<String> {
    use std::collections::HashMap;

    // ── Fecha legible ────────────────────────────────────────────────────────
    let generated_at = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        // fecha aproximada sin chrono dependencia extra
        format_unix_timestamp_approx(secs)
    };

    // ── KPIs ─────────────────────────────────────────────────────────────────
    let total_clientes = input.abc.len();
    let clientes_a = input.abc.iter().filter(|r| r.clase_abc == "A").count();
    let clientes_alto_riesgo = input.dso.iter().filter(|r| r.riesgo == "Alto").count();

    // ── ABC rows ─────────────────────────────────────────────────────────────
    let max_abc = input.abc.iter().map(|r| r.total_facturado).max().unwrap_or(1).max(1);
    let abc_tpl: Vec<AbcRowTpl> = input
        .abc
        .iter()
        .map(|r| AbcRowTpl {
            cliente_nombre: r.cliente_nombre.clone(),
            total_facturado_fmt: format_currency(r.total_facturado),
            porcentaje_sobre_total: r.porcentaje_sobre_total,
            porcentaje_acumulado: r.porcentaje_acumulado,
            clase_abc: r.clase_abc.clone(),
            bar_pct: (r.total_facturado as f64 / max_abc as f64 * 100.0).min(100.0),
        })
        .collect();

    // ── DSO rows ─────────────────────────────────────────────────────────────
    let dso_tpl: Vec<DsoRowTpl> = input
        .dso
        .iter()
        .map(|r| DsoRowTpl {
            cliente_nombre: r.cliente_nombre.clone(),
            total_facturado_fmt: format_currency(r.total_facturado),
            retraso_medio_dias: r.retraso_medio_dias,
            riesgo: r.riesgo.clone(),
        })
        .collect();

    // ── Heatmap filas + meses ────────────────────────────────────────────────
    // Obtener lista ordenada de meses y conceptos únicos
    let mut meses_set: Vec<String> = input
        .heatmap
        .iter()
        .map(|r| r.anio_mes.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    meses_set.sort();

    let conceptos: Vec<String> = {
        let mut seen = std::collections::BTreeSet::new();
        input
            .heatmap
            .iter()
            .filter(|r| seen.insert(r.concepto.clone()))
            .map(|r| r.concepto.clone())
            .collect()
    };

    // Construir lookup: (concepto, mes) → total
    let mut lookup: HashMap<(String, String), i64> = HashMap::new();
    for r in &input.heatmap {
        lookup.insert((r.concepto.clone(), r.anio_mes.clone()), r.total_facturado);
    }

    // Máx global para normalizar intensidad
    let max_heat = input
        .heatmap
        .iter()
        .map(|r| r.total_facturado)
        .max()
        .unwrap_or(1)
        .max(1) as f64;

    let heatmap_filas: Vec<HeatmapFilaTpl> = conceptos
        .iter()
        .map(|concepto| {
            let celdas = meses_set
                .iter()
                .map(|mes| {
                    let valor = *lookup
                        .get(&(concepto.clone(), mes.clone()))
                        .unwrap_or(&0);
                    let nivel = if valor == 0 {
                        0
                    } else {
                        let pct = valor as f64 / max_heat;
                        if pct < 0.20 { 1 } else if pct < 0.40 { 2 } else if pct < 0.60 { 3 } else if pct < 0.80 { 4 } else { 5 }
                    };
                    HeatmapCeldaTpl {
                        nivel,
                        valor,
                        valor_fmt: if valor > 0 { format_currency(valor) } else { String::new() },
                    }
                })
                .collect();
            HeatmapFilaTpl {
                concepto: concepto.clone(),
                celdas,
            }
        })
        .collect();

    let total_meses = meses_set.len();

    // ── Renderizar Tera ───────────────────────────────────────────────────────
    let mut ctx = Context::new();
    ctx.insert("empresa_nombre", &input.empresa_nombre);
    ctx.insert("generated_at", &generated_at);
    ctx.insert("total_clientes", &total_clientes);
    ctx.insert("clientes_a", &clientes_a);
    ctx.insert("clientes_alto_riesgo", &clientes_alto_riesgo);
    ctx.insert("total_meses", &total_meses);
    ctx.insert("abc", &abc_tpl);
    ctx.insert("dso", &dso_tpl);
    ctx.insert("meses", &meses_set);
    ctx.insert("heatmap_filas", &heatmap_filas);

    Tera::one_off(ADVANCED_STATS_TEMPLATE, &ctx, false).map_err(|e| {
        AppError::Internal(format!(
            "Error al renderizar plantilla de estadísticas: {e}"
        ))
    })
}

/// Formatea un Unix timestamp en una cadena de fecha/hora aproximada (sin chrono).
fn format_unix_timestamp_approx(secs: u64) -> String {
    // Aproximación simple: días desde epoch
    let days_since_epoch = secs / 86400;
    // Algoritmo civil de Richards para fecha gregoriana
    let z = days_since_epoch + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let hour = (secs % 86400) / 3600;
    let min = (secs % 3600) / 60;
    format!("{:02}/{:02}/{:04} {:02}:{:02}", d, m, y, hour, min)
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
