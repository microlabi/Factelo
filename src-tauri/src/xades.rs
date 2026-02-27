//! Firma XAdES-EPES para Facturae 3.2.x
//!
//! Implementación nativa para Windows que usa el Almacén de Certificados del
//! Sistema Operativo. No requiere ningún archivo .p12 ni contraseña:
//! el usuario selecciona su certificado digital instalado (DNIe, FNMT, etc.)
//! a través del diálogo nativo de Windows, igual que hace Chrome o Acrobat.
//!
//! Algoritmos (compatibles con Facturae 3.2.x / VALIDe):
//!   - CanonicalizationMethod : http://www.w3.org/TR/2001/REC-xml-c14n-20010315
//!   - SignatureMethod         : http://www.w3.org/2000/09/xmldsig#rsa-sha1
//!   - DigestMethod            : http://www.w3.org/2000/09/xmldsig#sha1
//!   - Política de firma       : Facturae v3.1

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use sha1::Digest as _;
use x509_cert::der::Decode as _;

use crate::error::{AppError, AppResult};

// ─── Punto de entrada ────────────────────────────────────────────────────────

/// Firma un XML Facturae 3.2.x con XAdES-EPES mediante el almacén de
/// certificados del sistema operativo.
///
/// * `unsigned_xml` – XML generado por `facturae_to_xml()`.
/// * `parent_hwnd`  – Handle de la ventana Tauri (para anclar el diálogo nativo).
pub fn sign_xml_xades(unsigned_xml: &str, parent_hwnd: Option<isize>) -> AppResult<String> {
    if unsigned_xml.trim().is_empty() {
        return Err(AppError::Validation(
            "El XML a firmar no puede estar vacío".to_string(),
        ));
    }

    // ── 1. Seleccionar certificado y firmar mediante Windows CNG ─────────────
    #[cfg(target_os = "windows")]
    let material = win_sign::pick_cert_and_sign(unsigned_xml, parent_hwnd)?;

    #[cfg(not(target_os = "windows"))]
    let material: CertMaterial = {
        let _ = parent_hwnd;
        return Err(AppError::NotImplemented(
            "La firma con almacén del sistema solo está disponible en Windows".to_string(),
        ));
    };

    // ── 2. Extraer información del certificado X.509 ─────────────────────────
    let x509 = x509_cert::Certificate::from_der(&material.cert_der)
        .map_err(|e| AppError::Certificate(format!("Certificado inválido: {e}")))?;

    let issuer_dn = x509.tbs_certificate.issuer.to_string();
    let serial_decimal = bytes_to_decimal(x509.tbs_certificate.serial_number.as_bytes());
    let cert_sha1_b64 = sha1_b64(&material.cert_der);
    let cert_b64 = B64.encode(&material.cert_der);

    // ── 3. Digest del documento ───────────────────────────────────────────────
    let doc_c14n = strip_xml_declaration(unsigned_xml);
    let doc_digest_b64 = sha1_b64(doc_c14n.as_bytes());

    // ── 4. Construir SignedProperties y su digest ────────────────────────────
    let signing_time = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    let sig_id = "Factelo-Sig";
    let signed_props_id = "Factelo-SignedProps";

    let signed_props_xml = build_signed_properties(
        signed_props_id,
        &signing_time,
        &cert_sha1_b64,
        &issuer_dn,
        &serial_decimal,
    );
    let sp_digest_b64 = sha1_b64(signed_props_xml.as_bytes());

    // ── 5. Construir SignedInfo ───────────────────────────────────────────────
    let signed_info_xml = build_signed_info(&doc_digest_b64, signed_props_id, &sp_digest_b64);

    // ── 6. Codificar la firma RSA en Base64 ──────────────────────────────────
    let sig_b64 = B64.encode(&material.signature);

    // ── 7. Montar el bloque <ds:Signature> ───────────────────────────────────
    let signature_block = build_signature_block(
        sig_id,
        signed_props_id,
        &signed_info_xml,
        &sig_b64,
        &cert_b64,
        &signing_time,
        &cert_sha1_b64,
        &issuer_dn,
        &serial_decimal,
    );

    // ── 8. Inyectar firma en el XML ───────────────────────────────────────────
    let closing = "</fe:Facturae>";
    if !unsigned_xml.contains(closing) {
        return Err(AppError::Internal(
            "El XML no contiene </fe:Facturae>. ¿Es un Facturae válido?".to_string(),
        ));
    }

    Ok(unsigned_xml.replacen(
        closing,
        &format!("{signature_block}{closing}"),
        1,
    ))
}

// ─── Material criptográfico ───────────────────────────────────────────────────

#[allow(dead_code)]
struct CertMaterial {
    cert_der: Vec<u8>,
    /// Bytes RSA-SHA1 PKCS#1v15 de la firma, sin codificar.
    signature: Vec<u8>,
}

// ─── Implementación Windows ───────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win_sign {
    use windows::{
        core::PCSTR,
        Win32::{
            Foundation::{BOOL, HWND},
            Security::Cryptography::{
                CertCloseStore, CertFreeCertificateContext, CertOpenSystemStoreA,
                CryptAcquireCertificatePrivateKey, NCryptFreeObject, NCryptSignHash,
                BCRYPT_PAD_PKCS1, BCRYPT_PKCS1_PADDING_INFO, CERT_KEY_SPEC,
                CRYPT_ACQUIRE_ONLY_NCRYPT_KEY_FLAG, HCRYPTPROV_OR_NCRYPT_KEY_HANDLE,
                NCRYPT_FLAGS, NCRYPT_HANDLE, NCRYPT_KEY_HANDLE,
            },
            Security::Cryptography::UI::CryptUIDlgSelectCertificateFromStore,
        },
    };
    use windows::core::PCWSTR;

    use crate::error::{AppError, AppResult};
    use super::CertMaterial;

    pub(super) fn pick_cert_and_sign(
        signed_info_xml: &str,
        parent_hwnd: Option<isize>,
    ) -> AppResult<CertMaterial> {
        use sha1::Digest as _;
        let hash_bytes: [u8; 20] = sha1::Sha1::digest(signed_info_xml.as_bytes()).into();

        unsafe {
            // 1. Abrir el almacén personal del usuario
            let store =
                CertOpenSystemStoreA(None, PCSTR::from_raw(b"MY\0".as_ptr())).map_err(|e| {
                    AppError::Certificate(format!(
                        "No se pudo abrir el almacén de certificados: {e}"
                    ))
                })?;

            let hwnd = HWND(
                parent_hwnd
                    .map(|h| h as *mut std::ffi::c_void)
                    .unwrap_or(std::ptr::null_mut()),
            );

            // 2. Diálogo nativo de selección de certificado
            let cert_ctx = CryptUIDlgSelectCertificateFromStore(
                store,
                hwnd,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
                0,
                std::ptr::null(),
            );

            if cert_ctx.is_null() {
                let _ = CertCloseStore(store, 0);
                return Err(AppError::Certificate(
                    "No se seleccionó ningún certificado. Firma cancelada.".to_string(),
                ));
            }

            // 3. Bytes DER del certificado
            let ctx = &*cert_ctx;
            let cert_der = std::slice::from_raw_parts(
                ctx.pbCertEncoded,
                ctx.cbCertEncoded as usize,
            )
            .to_vec();

            // 4. Obtener la clave NCrypt del certificado
            let mut raw_key_handle = HCRYPTPROV_OR_NCRYPT_KEY_HANDLE::default();
            let mut key_spec = CERT_KEY_SPEC::default();
            let mut caller_free = BOOL::default();

            let acquire_ok = CryptAcquireCertificatePrivateKey(
                cert_ctx,
                CRYPT_ACQUIRE_ONLY_NCRYPT_KEY_FLAG,
                None,
                &mut raw_key_handle,
                Some(&mut key_spec),
                Some(&mut caller_free),
            );

            if acquire_ok.is_err() {
                let _ = CertFreeCertificateContext(Some(cert_ctx));
                let _ = CertCloseStore(store, 0);
                return Err(AppError::Certificate(
                    "No se pudo obtener la clave privada del certificado. \
                     Comprueba que el dispositivo está conectado."
                        .to_string(),
                ));
            }

            // CRYPT_ACQUIRE_ONLY_NCRYPT_KEY_FLAG garantiza NCRYPT_KEY_HANDLE
            let ncrypt_key: NCRYPT_KEY_HANDLE = std::mem::transmute(raw_key_handle);

            // 5. Firmar hash SHA1 con PKCS#1 v1.5
            let padding_info = BCRYPT_PKCS1_PADDING_INFO {
                pszAlgId: windows::Win32::Security::Cryptography::BCRYPT_SHA1_ALGORITHM,
            };
            let padding_ptr: *const std::ffi::c_void =
                &padding_info as *const BCRYPT_PKCS1_PADDING_INFO as *const _;

            // Tamaño de la firma
            let mut sig_len = 0u32;
            let _ = NCryptSignHash(
                ncrypt_key,
                Some(padding_ptr),
                &hash_bytes,
                None,
                &mut sig_len,
                NCRYPT_FLAGS(BCRYPT_PAD_PKCS1.0),
            );

            if sig_len == 0 {
                release_handles(ncrypt_key, caller_free, cert_ctx, store);
                return Err(AppError::Certificate(
                    "NCryptSignHash devolvió tamaño 0. \
                     ¿La clave privada está disponible?"
                        .to_string(),
                ));
            }

            // Firma real
            let mut signature = vec![0u8; sig_len as usize];
            let sign_result = NCryptSignHash(
                ncrypt_key,
                Some(padding_ptr),
                &hash_bytes,
                Some(&mut signature),
                &mut sig_len,
                NCRYPT_FLAGS(BCRYPT_PAD_PKCS1.0),
            );

            release_handles(ncrypt_key, caller_free, cert_ctx, store);

            sign_result.map_err(|e| {
                AppError::Certificate(format!("Error al firmar: {e}"))
            })?;

            signature.truncate(sig_len as usize);

            Ok(CertMaterial { cert_der, signature })
        }
    }

    unsafe fn release_handles(
        ncrypt_key: NCRYPT_KEY_HANDLE,
        caller_free: BOOL,
        cert_ctx: *const windows::Win32::Security::Cryptography::CERT_CONTEXT,
        store: windows::Win32::Security::Cryptography::HCERTSTORE,
    ) {
        if caller_free.as_bool() {
            let _ = NCryptFreeObject(NCRYPT_HANDLE(ncrypt_key.0));
        }
        let _ = CertFreeCertificateContext(Some(cert_ctx));
        let _ = CertCloseStore(store, 0);
    }
}

// ─── Constructores de fragmentos XAdES XML ───────────────────────────────────

fn build_signed_properties(
    id: &str,
    signing_time: &str,
    cert_sha1_b64: &str,
    issuer_dn: &str,
    serial_decimal: &str,
) -> String {
    const POLICY_URL: &str = concat!(
        "http://www.facturae.es/politica_de_firma_formato_facturae/",
        "politica_de_firma_formato_facturae_v3_1.pdf"
    );
    const POLICY_SHA1: &str = "Ohixl6upD6av8N7pEvDABhEL6hM=";
    const ALG_SHA1: &str = "http://www.w3.org/2000/09/xmldsig#sha1";
    const NS_XADES: &str = "http://uri.etsi.org/01903/v1.3.2#";
    const NS_DS: &str = "http://www.w3.org/2000/09/xmldsig#";

    let issuer_escaped = xml_escape(issuer_dn);

    format!(
        r##"<xades:SignedProperties Id="{id}" xmlns:xades="{ns_xades}" xmlns:ds="{ns_ds}"><xades:SignedSignatureProperties><xades:SigningTime>{time}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="{alg}"/><ds:DigestValue>{cert_sha1}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>{issuer}</ds:X509IssuerName><ds:X509SerialNumber>{serial}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>{policy_url}</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash><ds:DigestMethod Algorithm="{alg}"/><ds:DigestValue>{policy_sha1}</ds:DigestValue></xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier></xades:SignedSignatureProperties></xades:SignedProperties>"##,
        id = id,
        ns_xades = NS_XADES,
        ns_ds = NS_DS,
        time = signing_time,
        alg = ALG_SHA1,
        cert_sha1 = cert_sha1_b64,
        issuer = issuer_escaped,
        serial = serial_decimal,
        policy_url = POLICY_URL,
        policy_sha1 = POLICY_SHA1,
    )
}

fn build_signed_info(doc_digest_b64: &str, signed_props_id: &str, sp_digest_b64: &str) -> String {
    const C14N: &str = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
    const RSA_SHA1: &str = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
    const SHA1: &str = "http://www.w3.org/2000/09/xmldsig#sha1";
    const ENV_SIG: &str = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
    const NS_DS: &str = "http://www.w3.org/2000/09/xmldsig#";

    format!(
        r##"<ds:SignedInfo xmlns:ds="{ns_ds}"><ds:CanonicalizationMethod Algorithm="{c14n}"/><ds:SignatureMethod Algorithm="{rsa_sha1}"/><ds:Reference Id="signed-data-ref" URI=""><ds:Transforms><ds:Transform Algorithm="{env_sig}"/></ds:Transforms><ds:DigestMethod Algorithm="{sha1}"/><ds:DigestValue>{doc_digest}</ds:DigestValue></ds:Reference><ds:Reference URI="#{sp_id}"><ds:DigestMethod Algorithm="{sha1}"/><ds:DigestValue>{sp_digest}</ds:DigestValue></ds:Reference></ds:SignedInfo>"##,
        ns_ds = NS_DS,
        c14n = C14N,
        rsa_sha1 = RSA_SHA1,
        sha1 = SHA1,
        env_sig = ENV_SIG,
        doc_digest = doc_digest_b64,
        sp_id = signed_props_id,
        sp_digest = sp_digest_b64,
    )
}

#[allow(clippy::too_many_arguments)]
fn build_signature_block(
    sig_id: &str,
    signed_props_id: &str,
    signed_info_xml: &str,
    sig_b64: &str,
    cert_b64: &str,
    signing_time: &str,
    cert_sha1_b64: &str,
    issuer_dn: &str,
    serial_decimal: &str,
) -> String {
    const POLICY_URL: &str = concat!(
        "http://www.facturae.es/politica_de_firma_formato_facturae/",
        "politica_de_firma_formato_facturae_v3_1.pdf"
    );
    const POLICY_SHA1: &str = "Ohixl6upD6av8N7pEvDABhEL6hM=";
    const ALG_SHA1: &str = "http://www.w3.org/2000/09/xmldsig#sha1";
    const NS_DS: &str = "http://www.w3.org/2000/09/xmldsig#";
    const NS_XADES: &str = "http://uri.etsi.org/01903/v1.3.2#";

    let obj_id = "Factelo-Object";
    let issuer_escaped = xml_escape(issuer_dn);

    format!(
        r##"<ds:Signature Id="{sig_id}" xmlns:ds="{ns_ds}">{signed_info}<ds:SignatureValue>{sig_value}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>{cert_b64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object Id="{obj_id}"><xades:QualifyingProperties xmlns:xades="{ns_xades}" Target="#{sig_id}"><xades:SignedProperties Id="{sp_id}"><xades:SignedSignatureProperties><xades:SigningTime>{time}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="{alg}"/><ds:DigestValue>{cert_sha1}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>{issuer}</ds:X509IssuerName><ds:X509SerialNumber>{serial}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>{policy_url}</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash><ds:DigestMethod Algorithm="{alg}"/><ds:DigestValue>{policy_sha1}</ds:DigestValue></xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier></xades:SignedSignatureProperties></xades:SignedProperties></xades:QualifyingProperties></ds:Object></ds:Signature>"##,
        sig_id = sig_id,
        ns_ds = NS_DS,
        signed_info = signed_info_xml,
        sig_value = sig_b64,
        cert_b64 = cert_b64,
        obj_id = obj_id,
        ns_xades = NS_XADES,
        sp_id = signed_props_id,
        time = signing_time,
        alg = ALG_SHA1,
        cert_sha1 = cert_sha1_b64,
        issuer = issuer_escaped,
        serial = serial_decimal,
        policy_url = POLICY_URL,
        policy_sha1 = POLICY_SHA1,
    )
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

fn strip_xml_declaration(xml: &str) -> &str {
    let s = xml.trim_start();
    if s.starts_with("<?xml") {
        if let Some(end) = s.find("?>") {
            return s[end + 2..].trim_start();
        }
    }
    s
}

fn sha1_b64(data: &[u8]) -> String {
    B64.encode(sha1::Sha1::digest(data))
}

fn bytes_to_decimal(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "0".to_string();
    }
    let mut limbs: Vec<u64> = vec![0];
    for &b in bytes {
        let mut carry = b as u64;
        for limb in limbs.iter_mut() {
            let v = *limb * 256 + carry;
            *limb = v % 1_000_000_000;
            carry = v / 1_000_000_000;
        }
        if carry > 0 {
            limbs.push(carry);
        }
    }
    let mut s = String::new();
    for (i, &limb) in limbs.iter().enumerate().rev() {
        if i == limbs.len() - 1 {
            s.push_str(&limb.to_string());
        } else {
            s.push_str(&format!("{limb:09}"));
        }
    }
    s
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
