//! Módulo de integración AEAT/Verifactu
//!
//! Permite enviar facturas al endpoint de AEAT/Verifactu, seleccionando entorno (sandbox/producción)

use reqwest::blocking::Client;
use std::env;
use crate::error::{AppError, AppResult};
use crate::db::DbPool;
use chrono::Utc;

/// Envia el XML firmado de la factura al endpoint AEAT/Verifactu y registra el resultado en la base de datos
pub fn enviar_factura_aeat(xml: &str, env: Option<&str>, factura_id: Option<i64>, db: Option<&DbPool>) -> AppResult<String> {
    let entorno = env.unwrap_or_else(|| {
        std::env::var("AEAT_ENV").unwrap_or_else(|_| "sandbox".to_string())
    });
    let endpoint = match entorno.as_str() {
        "produccion" => "https://verifactu.aeat.es/api/facturae",
        _ => "https://verifactu-sandbox.aeat.es/api/facturae",
    };
    let client = Client::new();
    let res = client.post(endpoint)
        .header("Content-Type", "application/xml")
        .body(xml.to_string())
        .send();
    let resultado = match res {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().unwrap_or_default();
            if let (Some(fid), Some(db)) = (factura_id, db) {
                let _ = sqlx::query(
                    "INSERT INTO envio_aeat_log (factura_id, entorno, status, respuesta, fecha_envio) VALUES (?1, ?2, ?3, ?4, ?5)"
                )
                .bind(fid)
                .bind(&entorno)
                .bind(status as i64)
                .bind(&body)
                .bind(Utc::now().to_string())
                .execute(db);
            }
            if status >= 200 && status < 300 {
                Ok(body)
            } else {
                Err(AppError::Api(format!("Error AEAT: {}", status)))
            }
        }
        Err(e) => Err(AppError::Api(format!("Error HTTP: {e}")))
    };
    resultado
}
