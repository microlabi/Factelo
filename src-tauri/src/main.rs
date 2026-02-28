mod audit;
mod auth;
mod commands;
mod db;
mod error;
mod facturae;
mod keychain;
mod logger;
mod pdf;

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
            commands::generar_y_firmar_facturae,
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
            commands::obtener_factura_detalle,
            pdf::generate_pdf,
            pdf::abrir_archivo,
            // ── Registro Inalterable (Veri*factu / Camino 2) ─────────────
            audit::verificar_integridad_bd,
            audit::generar_qr_legal,
            audit::generar_fichero_inspeccion
        ])
        .setup(|app| {
            // ── 1. Resolver la ruta del directorio de datos ──────────────────────
            //
            // Ruta nueva (protegida):
            //   Windows: C:\Users\<user>\AppData\Local\com.factelo.desktop\.fdata\v1.dat
            //
            // Se detecta automáticamente si existe la DB en la ruta antigua
            // (factelo.db en app_local_data_dir) para migrarla sin pérdida de datos.
            //
            let app_local = app
                .path()
                .app_local_data_dir()
                .map_err(|error| {
                    std::io::Error::other(format!(
                        "No se pudo resolver app_local_data_dir: {error}"
                    ))
                })?;

            let legacy_db_path = app_local.join("factelo.db");

            let (data_dir, database_path) = match std::env::var("FACTELO_DB_PATH") {
                Ok(path) => {
                    // Desarrollo: ruta forzada por variable de entorno
                    let p = std::path::PathBuf::from(path);
                    let dir = p.parent().map(|d| d.to_path_buf())
                        .unwrap_or_else(|| std::path::PathBuf::from("."));
                    (dir, p)
                }
                Err(_) => {
                    let new_dir  = app_local.join(".fdata");
                    let new_path = new_dir.join("v1.dat");
                    (new_dir, new_path)
                }
            };

            // ── 2. Crear el directorio y aplicar permisos restrictivos ───────────
            std::fs::create_dir_all(&data_dir).map_err(|e| {
                std::io::Error::other(format!("No se pudo crear el directorio de datos: {e}"))
            })?;

            db::restrict_directory_permissions(&data_dir);

            // ── 3. Migración desde la ruta antigua si procede ────────────────────
            //
            // Si la DB antigua existe y la nueva todavía no, la copiamos al
            // nuevo directorio protegido para no perder datos del usuario.
            if legacy_db_path.exists() && !database_path.exists()
                && std::env::var("FACTELO_DB_PATH").is_err()
            {
                tracing::info!(
                    "Migrando base de datos desde la ruta antigua {:?} a {:?}",
                    legacy_db_path,
                    database_path
                );
                if let Err(e) = std::fs::copy(&legacy_db_path, &database_path) {
                    tracing::warn!(
                        "No se pudo migrar la DB antigua: {e}. \
                         Se creará una nueva base de datos."
                    );
                } else {
                    // Copiar también ficheros WAL/SHM si existen
                    for ext in ["-wal", "-shm"] {
                        let src = legacy_db_path.with_extension(
                            format!("db{ext}")
                        );
                        if src.exists() {
                            let dst = database_path.with_extension(
                                format!("dat{ext}")
                            );
                            let _ = std::fs::copy(&src, &dst);
                        }
                    }
                    tracing::info!("Migración completada. La ruta antigua puede eliminarse manualmente.");
                }
            }

            // ── 4. Provisionar la clave SQLCipher via DPAPI (Windows) ────────────
            //
            // Si la DB venía de la migración (antigua, sin cifrar), se abre sin
            // clave y se cifra en el siguiente arranque con `ATTACH` + rekey.
            // Para la mayoría de usuarios (instalación nueva) se genera
            // directamente una clave DPAPI en el primer arranque.
            let cipher_key: Option<String> = if legacy_db_path.exists()
                && std::env::var("FACTELO_DB_PATH").is_err()
            {
                // DB migrada desde versión anterior: abrimos sin cifrado por
                // ahora para no romper nada.  En una versión futura se puede
                // añadir re-cifrado con SQLCipher ATTACH.
                tracing::info!(
                    "DB preexistente detectada — se usa sin cifrado para \
                     compatibilidad con la versión anterior."
                );
                None
            } else {
                match std::env::var("FACTELO_DB_KEY") {
                    Ok(k) if !k.trim().is_empty() => {
                        tracing::warn!(
                            "Usando clave de BD desde variable de entorno (solo desarrollo)."
                        );
                        Some(k)
                    }
                    _ => match keychain::provision_db_key(&data_dir) {
                        Ok(k) => {
                            tracing::info!("Clave de BD provisionada correctamente.");
                            Some(k)
                        }
                        Err(e) => {
                            tracing::error!(
                                "No se pudo provisionar la clave de BD: {e:#}. \
                                 La base de datos se abrirá sin cifrado."
                            );
                            None
                        }
                    },
                }
            };

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
