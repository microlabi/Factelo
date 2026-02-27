use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2, Params, Version,
};
use rand_core::OsRng;

fn argon2_instance() -> anyhow::Result<Argon2<'static>> {
    let params = Params::new(19_456, 3, 1, Some(32))
        .map_err(|error| anyhow::anyhow!("Parámetros Argon2 inválidos: {error}"))?;
    Ok(Argon2::new(
        argon2::Algorithm::Argon2id,
        Version::V0x13,
        params,
    ))
}

pub fn hash_password(plain_password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = argon2_instance()?;

    let password_hash = argon2
        .hash_password(plain_password.as_bytes(), &salt)
        .map_err(|error| anyhow::anyhow!("No se pudo calcular hash Argon2: {error}"))?
        .to_string();

    Ok(password_hash)
}

pub fn verify_password(stored_hash: &str, candidate_password: &str) -> anyhow::Result<bool> {
    let parsed_hash = PasswordHash::new(stored_hash)
        .map_err(|error| anyhow::anyhow!("Hash de contraseña inválido: {error}"))?;
    let argon2 = argon2_instance()?;

    Ok(argon2
        .verify_password(candidate_password.as_bytes(), &parsed_hash)
        .is_ok())
}
