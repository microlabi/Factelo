use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XadesSignInput {
    pub cert_path: String,
    pub cert_password: String,
}

pub fn sign_xml_xades(unsigned_xml: &str, input: &XadesSignInput) -> AppResult<String> {
    if unsigned_xml.trim().is_empty() {
        return Err(AppError::Validation(
            "El XML a firmar no puede estar vacío".to_string(),
        ));
    }

    if input.cert_password.trim().is_empty() {
        return Err(AppError::Validation(
            "La contraseña del certificado es obligatoria".to_string(),
        ));
    }

    validate_certificate_path(&input.cert_path)?;
    let _certificate_bytes = std::fs::read(&input.cert_path)?;

    Err(AppError::NotImplemented(
        "Firma XAdES pendiente: parseo PKCS#12, creación de SignedProperties, SignedInfo y Reference para Facturae 3.2.x".to_string(),
    ))
}

fn validate_certificate_path(cert_path: &str) -> AppResult<()> {
    let path = Path::new(cert_path);

    if !path.exists() {
        return Err(AppError::Certificate(format!(
            "No existe el certificado en la ruta: {cert_path}"
        )));
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if extension != "p12" && extension != "pfx" {
        return Err(AppError::Certificate(
            "El certificado debe tener extensión .p12 o .pfx".to_string(),
        ));
    }

    Ok(())
}
