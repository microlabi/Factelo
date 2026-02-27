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
        let escaped = key.replace('\'', "''");
        let pragma_key = format!("PRAGMA key = '{escaped}';");
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
