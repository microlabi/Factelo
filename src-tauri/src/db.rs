use std::{path::Path, str::FromStr, time::Duration};

use anyhow::Context;
use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Pool, Sqlite,
};

pub type DbPool = Pool<Sqlite>;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn init_pool(database_path: &Path, encryption_key: Option<&str>) -> anyhow::Result<DbPool> {
    ensure_parent_folder(database_path).await?;

    let database_url = sqlite_url(database_path);
    let connect_options = SqliteConnectOptions::from_str(&database_url)
        .context("URL de conexión SQLite inválida")?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(30))
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .context("No se pudo conectar a SQLite")?;

    apply_security_pragmas(&pool, encryption_key).await?;

    MIGRATOR
        .run(&pool)
        .await
        .context("No se pudieron aplicar migraciones")?;

    Ok(pool)
}

fn sqlite_url(database_path: &Path) -> String {
    let normalized = database_path.to_string_lossy().replace('\\', "/");
    format!("sqlite://{normalized}")
}

async fn ensure_parent_folder(database_path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = database_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("No se pudo crear el directorio {:?}", parent))?;
    }

    Ok(())
}

async fn apply_security_pragmas(pool: &DbPool, encryption_key: Option<&str>) -> anyhow::Result<()> {
    sqlx::query("PRAGMA trusted_schema = OFF;")
        .execute(pool)
        .await
        .context("No se pudo aplicar PRAGMA trusted_schema")?;

    if let Some(key) = encryption_key.filter(|value| !value.trim().is_empty()) {
        // SQLCipher acepta la clave en formato hex literal: PRAGMA key = "x'hexstring'";
        // Los 32 bytes se pasan como 64 caracteres hexadecimales.
        let pragma_key = format!("PRAGMA key = \"x'{key}'\";");
        sqlx::query(&pragma_key)
            .execute(pool)
            .await
            .context("No se pudo aplicar PRAGMA key (SQLCipher)")?;

        sqlx::query("PRAGMA cipher_compatibility = 4;")
            .execute(pool)
            .await
            .context("No se pudo aplicar PRAGMA cipher_compatibility")?;
    }

    Ok(())
}

// ─── Restricción de permisos del directorio de datos ──────────────────────────

/// Aplica permisos restrictivos al directorio donde se almacena la base de
/// datos para que únicamente el usuario actual (y SYSTEM en Windows) pueda
/// acceder.
///
/// - **Windows**: usa `icacls` para revocar la herencia de ACLs y conceder
///   control total solo al usuario actual y a SYSTEM.
/// - **Unix/macOS**: establece `0700` (rwx------) con `chmod`.
///
/// Los fallos no son fatales: se registran como advertencia y la aplicación
/// sigue funcionando (la protección SQLCipher sigue activa).
pub fn restrict_directory_permissions(dir: &Path) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // CREATE_NO_WINDOW: evita que aparezca una ventana de consola
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let dir_str = dir.to_string_lossy().into_owned();

        // Nombre de usuario del propietario de la sesión actual
        let username = std::env::var("USERNAME").unwrap_or_else(|_| "CURRENT_USER".to_string());

        // Paso 1 – restablecer ACLs al estado predeterminado (limpiar residuales)
        let _ = std::process::Command::new("icacls")
            .args([&dir_str, "/reset", "/T", "/Q"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        // Paso 2 – revocar herencia (no propagar los permisos del directorio padre)
        let step2 = std::process::Command::new("icacls")
            .args([&dir_str, "/inheritance:r", "/Q"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Err(e) = &step2 {
            tracing::warn!("icacls /inheritance:r falló: {e}");
        }

        // Paso 3 – conceder control total al usuario actual (hereda a hijos)
        let user_grant = format!("{username}:(OI)(CI)F");
        let step3 = std::process::Command::new("icacls")
            .args([&dir_str, "/grant:r", &user_grant, "/Q"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Err(e) = &step3 {
            tracing::warn!("icacls /grant:r (usuario) falló: {e}");
        }

        // Paso 4 – conceder control total a SYSTEM (Windows lo necesita internamente)
        let step4 = std::process::Command::new("icacls")
            .args([&dir_str, "/grant:r", "SYSTEM:(OI)(CI)F", "/Q"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Err(e) = &step4 {
            tracing::warn!("icacls /grant:r (SYSTEM) falló: {e}");
        }

        tracing::info!(
            "Permisos del directorio de datos restringidos a '{}' y SYSTEM.",
            username
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)) {
            Ok(()) => tracing::info!(
                "Permisos del directorio de datos: 0700 (rwx------): {:?}",
                dir
            ),
            Err(e) => tracing::warn!(
                "No se pudieron aplicar permisos 0700 al directorio {:?}: {e}",
                dir
            ),
        }
    }
}
