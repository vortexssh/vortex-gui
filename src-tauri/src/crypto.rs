use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use thiserror::Error;

pub const FILE_MAGIC: &[u8; 4] = b"VRTX";
pub const FILE_VERSION: u8 = 1;
pub const SALT_SIZE: usize = 16;
pub const NONCE_SIZE: usize = 12;
pub const KEY_SIZE: usize = 32;
pub const ARGON_TIME: u32 = 3;
pub const ARGON_MEMORY_KIB: u32 = 64 * 1024;
pub const ARGON_THREADS: u32 = 4;
pub const MIN_EXPORT_PASSWORD: usize = 12;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("ciphertext too short")]
    ShortCiphertext,
    #[error("invalid .vortex magic")]
    BadMagic,
    #[error("unsupported .vortex version: {0}")]
    BadVersion(u8),
    #[error("decryption failed: wrong password or corrupted file")]
    AuthFailed,
    #[error("password must be at least {MIN_EXPORT_PASSWORD} characters")]
    WeakPassword,
    #[error("crypto: {0}")]
    Other(String),
}

pub fn derive_key(password: &[u8], salt: &[u8]) -> Result<[u8; KEY_SIZE], CryptoError> {
    let params = Params::new(ARGON_MEMORY_KIB, ARGON_TIME, ARGON_THREADS, Some(KEY_SIZE))
        .map_err(|e| CryptoError::Other(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; KEY_SIZE];
    argon
        .hash_password_into(password, salt, &mut out)
        .map_err(|e| CryptoError::Other(e.to_string()))?;
    Ok(out)
}

pub fn encrypt_aes_gcm(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if key.len() != KEY_SIZE {
        return Err(CryptoError::Other("master key must be 32 bytes".into()));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::Other(e.to_string()))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| CryptoError::AuthFailed)?;
    let mut out = Vec::with_capacity(NONCE_SIZE + ct.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt_aes_gcm(key: &[u8], data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if key.len() != KEY_SIZE {
        return Err(CryptoError::Other("master key must be 32 bytes".into()));
    }
    if data.len() < NONCE_SIZE {
        return Err(CryptoError::ShortCiphertext);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::Other(e.to_string()))?;
    let nonce = Nonce::from_slice(&data[..NONCE_SIZE]);
    cipher
        .decrypt(nonce, &data[NONCE_SIZE..])
        .map_err(|_| CryptoError::AuthFailed)
}

pub fn encrypt_at_rest(master_key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    encrypt_aes_gcm(master_key, plaintext)
}

pub fn decrypt_at_rest(master_key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    decrypt_aes_gcm(master_key, ciphertext)
}

pub fn seal_vortex(password: &str, payload: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if password.len() < MIN_EXPORT_PASSWORD {
        return Err(CryptoError::WeakPassword);
    }
    let mut salt = [0u8; SALT_SIZE];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key(password.as_bytes(), &salt)?;
    let sealed = encrypt_aes_gcm(&key, payload)?;
    let mut out = Vec::with_capacity(4 + 1 + SALT_SIZE + sealed.len());
    out.extend_from_slice(FILE_MAGIC);
    out.push(FILE_VERSION);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&sealed);
    Ok(out)
}

pub fn open_vortex(password: &str, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if data.len() < 4 + 1 + SALT_SIZE + NONCE_SIZE + 16 {
        return Err(CryptoError::ShortCiphertext);
    }
    if &data[..4] != FILE_MAGIC {
        return Err(CryptoError::BadMagic);
    }
    if data[4] != FILE_VERSION {
        return Err(CryptoError::BadVersion(data[4]));
    }
    let salt = &data[5..5 + SALT_SIZE];
    let sealed = &data[5 + SALT_SIZE..];
    let key = derive_key(password.as_bytes(), salt)?;
    decrypt_aes_gcm(&key, sealed)
}

pub fn random_key() -> Result<[u8; KEY_SIZE], CryptoError> {
    let mut key = [0u8; KEY_SIZE];
    rand::thread_rng().fill_bytes(&mut key);
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aes_gcm_roundtrip() {
        let key = random_key().unwrap();
        let plain = b"super-secret-password";
        let ct = encrypt_at_rest(&key, plain).unwrap();
        let out = decrypt_at_rest(&key, &ct).unwrap();
        assert_eq!(out, plain);
    }

    #[test]
    fn vortex_seal_open() {
        let payload = br#"{"version":1,"hosts":[]}"#;
        let sealed = seal_vortex("twelvechars!!", payload).unwrap();
        assert_eq!(&sealed[..4], FILE_MAGIC);
        let out = open_vortex("twelvechars!!", &sealed).unwrap();
        assert_eq!(out, payload);
        assert!(open_vortex("wrong-password-xx", &sealed).is_err());
    }

    #[test]
    fn weak_password() {
        let err = seal_vortex("short", b"{}").unwrap_err();
        assert!(matches!(err, CryptoError::WeakPassword));
    }

    #[test]
    fn open_tui_fixture() {
        let data = include_bytes!("../tests/testdata/from-tui.vortex");
        let out = open_vortex("twelvechars!!", data).unwrap();
        assert_eq!(out, br#"{"version":1,"hosts":[]}"#);
    }
}
