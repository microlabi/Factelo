mod auth;
mod commands;
mod db;
mod error;
mod facturae;
mod logger;
mod pdf;
mod xades;

use std::path::PathBuf;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::insert_factura,
            commands::generar_facturae_xml,
            commands::generar_facturae_autofirma,
            commands::firmar_factura_silenciosa,
            commands::verificar_onboarding,
            commands::obtener_empresas,
            commands::crear_empresa,
            commands::obtener_series,
            commands::crear_serie,
            commands::obtener_clientes,
            commands::crear_cliente,
            commands::obtener_productos,
            commands::crear_producto,
            commands::obtener_dashboard_stats,
            commands::listar_facturas,
            pdf::generate_pdf
        ])
        .setup(|app| {
            let database_path = match std::env::var("FACTELO_DB_PATH") {
                Ok(path) => PathBuf::from(path),
                Err(_) => app
                    .path()
                    .app_local_data_dir()
                    .map_err(|error| {
                        std::io::Error::other(format!(
                            "No se pudo resolver app_local_data_dir: {error}"
                        ))
                    })?
                    .join("factelo.db"),
            };
            let cipher_key = std::env::var("FACTELO_DB_KEY").ok();

            let pool = tauri::async_runtime::block_on(db::init_pool(
                &database_path,
                cipher_key.as_deref(),
            ))
            .map_err(|error| {
                tracing::error!("No se pudo iniciar la base de datos: {error:#}");
                error
            })?;

            app.manage(pool);
            tracing::info!("Backend inicializado correctamente.");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error al ejecutar la aplicación Tauri");
}
