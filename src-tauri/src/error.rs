use serde::Serialize;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;
pub type CommandResult<T> = Result<T, ApiError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Error de validación: {0}")]
    Validation(String),
    #[error("Recurso no encontrado: {0}")]
    NotFound(String),
    #[error("Error de base de datos: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Error de serialización JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Error de serialización XML: {0}")]
    Xml(#[from] quick_xml::se::SeError),
    #[error("Error de entrada/salida: {0}")]
    Io(#[from] std::io::Error),
    #[error("Error de certificado: {0}")]
    Certificate(String),
    #[error("No implementado: {0}")]
    NotImplemented(String),
    #[error("Error interno: {0}")]
    Internal(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl From<AppError> for ApiError {
    fn from(value: AppError) -> Self {
        let code = match value {
            AppError::Validation(_) => "VALIDATION_ERROR",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Database(_) => "DATABASE_ERROR",
            AppError::Json(_) | AppError::Xml(_) => "SERIALIZATION_ERROR",
            AppError::Io(_) => "IO_ERROR",
            AppError::Certificate(_) => "CERTIFICATE_ERROR",
            AppError::NotImplemented(_) => "NOT_IMPLEMENTED",
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
        .to_string();

        Self {
            code,
            message: value.to_string(),
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        AppError::Internal(value.to_string())
    }
}
