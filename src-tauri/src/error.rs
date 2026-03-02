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
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
        .to_string();

        // Para errores de base de datos e internos no reenviamos el mensaje
        // de bajo nivel al frontend (puede contener rutas del sistema o
        // detalles de SQLite).  Los errores de validación y NOT_FOUND sí se
        // propagan porque su mensaje es intencional y legible para el usuario.
        let message = match &value {
            AppError::Database(_) => {
                tracing::error!("Error de base de datos (detalle interno): {value}");
                "Se produjo un error en la base de datos. Consulta los registros de la aplicación para más detalles.".to_string()
            }
            AppError::Internal(_) => {
                tracing::error!("Error interno (detalle interno): {value}");
                "Se produjo un error interno. Consulta los registros de la aplicación para más detalles.".to_string()
            }
            _ => value.to_string(),
        };

        Self { code, message }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        AppError::Internal(value.to_string())
    }
}
