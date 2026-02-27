//! keychain.rs — Gestión segura de la clave de cifrado de la base de datos
//!
//! Genera, cifra y recupera el secreto de 32 bytes que SQLCipher usa como
//! clave de la base de datos.
//!
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │  Windows : DPAPI (CryptProtectData  / CryptUnprotectData)               │
//! │            El blob cifrado está vinculado al perfil de usuario y al     │
//! │            equipo.  Otro usuario o máquina NO puede descifrarlo.        │
//! │  Otros   : Fichero de clave protegido con permisos 0o600.               │
//! └─────────────────────────────────────────────────────────────────────────┘
//!
//! Flujo de primer arranque:
//!   1. Generar 32 bytes aleatorios con OsRng
//!   2. Cifrar con DPAPI (Windows) → blob opaco de longitud variable
//!   3. Guardar el blob in `<db_dir>/.fks`
//!
//! Flujo de arranques posteriores:
//!   1. Leer `.fks`
//!   2. Descifrar con DPAPI → 32 bytes originales
//!   3. Devolver como string hexadecimal (formato que acepta SQLCipher PRAGMA key)

use std::path::Path;

use anyhow::{bail, Context};

// ─────────────────────────────────────────────────────────────────────────────

/// Nombre del fichero que almacena el blob cifrado de la clave.
/// El punto inicial lo hace "oculto" en Explorer y servicios de backup comunes.
const KEY_BLOB_FILE: &str = ".fks";

/// Provisiona (crea si no existe, o recupera) la clave de cifrado SQLCipher
/// para la base de datos ubicada en `db_dir`.
///
/// Devuelve la clave como cadena hexadecimal de 64 caracteres (32 bytes).
pub fn provision_db_key(db_dir: &Path) -> anyhow::Result<String> {
    let blob_path = db_dir.join(KEY_BLOB_FILE);

    if blob_path.exists() {
        // ── Recuperar clave existente ──────────────────────────────────────
        load_key(&blob_path)
    } else {
        // ── Generar y persistir nueva clave ────────────────────────────────
        let raw_key = generate_random_key()?;
        persist_key(&blob_path, &raw_key)?;

        // Marcar el fichero como oculto en Windows
        #[cfg(target_os = "windows")]
        set_hidden_attribute(&blob_path);

        Ok(hex::encode(&raw_key))
    }
}

// ─── Generación ───────────────────────────────────────────────────────────────

fn generate_random_key() -> anyhow::Result<[u8; 32]> {
    use rand_core::{OsRng, RngCore};
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    Ok(key)
}

// ─── Persistencia / Lectura ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn persist_key(blob_path: &Path, raw_key: &[u8; 32]) -> anyhow::Result<()> {
    let encrypted = dpapi_encrypt(raw_key)?;
    std::fs::write(blob_path, &encrypted)
        .with_context(|| format!("No se pudo escribir el blob de clave en {:?}", blob_path))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn load_key(blob_path: &Path) -> anyhow::Result<String> {
    let encrypted = std::fs::read(blob_path)
        .with_context(|| format!("No se pudo leer el blob de clave desde {:?}", blob_path))?;
    if encrypted.is_empty() {
        bail!("El fichero de clave de base de datos está vacío o corrupto.");
    }
    let decrypted = dpapi_decrypt(&encrypted)?;
    if decrypted.len() != 32 {
        bail!(
            "La clave de base de datos tiene una longitud inesperada ({} bytes). \
             El fichero puede estar corrupto.",
            decrypted.len()
        );
    }
    Ok(hex::encode(&decrypted))
}

#[cfg(not(target_os = "windows"))]
fn persist_key(blob_path: &Path, raw_key: &[u8; 32]) -> anyhow::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::io::Write;

    // Crear el fichero con permisos 0600 (solo el propietario puede leer)
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(blob_path)
        .with_context(|| format!("No se pudo crear el fichero de clave en {:?}", blob_path))?;

    file.write_all(raw_key)
        .with_context(|| "No se pudo escribir la clave")?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn load_key(blob_path: &Path) -> anyhow::Result<String> {
    let raw = std::fs::read(blob_path)
        .with_context(|| format!("No se pudo leer el fichero de clave desde {:?}", blob_path))?;
    if raw.len() != 32 {
        bail!(
            "La clave de base de datos tiene una longitud inesperada ({} bytes).",
            raw.len()
        );
    }
    Ok(hex::encode(&raw))
}

// ─── DPAPI (solo Windows) ────────────────────────────────────────────────────

// LocalFree pertenece a Kernel32.dll. La declaramos directamente porque el
// feature `Win32_System_Memory` de la crate `windows` 0.58 no la expone.
#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(hmem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
}

#[cfg(target_os = "windows")]
fn dpapi_encrypt(plaintext: &[u8]) -> anyhow::Result<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        // CRYPTPROTECT_UI_FORBIDDEN : no mostrar cuadros de diálogo
        CryptProtectData(
            &mut input,
            windows::core::w!("Factelo DB Key"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .ok()
        .context("DPAPI CryptProtectData falló")?;

        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        // Liberar el buffer asignado por DPAPI
        LocalFree(output.pbData as *mut core::ffi::c_void);

        Ok(encrypted)
    }
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(ciphertext: &[u8]) -> anyhow::Result<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        CryptUnprotectData(
            &mut input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .ok()
        .context(
            "DPAPI CryptUnprotectData falló. \
             El fichero de clave puede haber sido copiado desde otro equipo \
             o perfil de usuario.",
        )?;

        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        // Borrar de memoria antes de liberar
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData as *mut core::ffi::c_void);

        Ok(decrypted)
    }
}

/// Marca el fichero .fks como oculto en el Explorador de Windows
#[cfg(target_os = "windows")]
fn set_hidden_attribute(path: &Path) {
    use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};

    let wide: Vec<u16> = path
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let _ = SetFileAttributesW(
            windows::core::PCWSTR::from_raw(wide.as_ptr()),
            FILE_ATTRIBUTE_HIDDEN,
        );
    }
}
