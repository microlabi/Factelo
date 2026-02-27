use tracing_subscriber::EnvFilter;

pub fn init() -> anyhow::Result<()> {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tauri=warn"));

    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(true)
        .compact()
        .try_init()
        .map_err(|error| anyhow::anyhow!("No se pudo inicializar tracing subscriber: {error}"))?;

    Ok(())
}
