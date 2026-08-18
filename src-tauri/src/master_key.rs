use std::fs;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::config::{KEYRING_SVC, KEYRING_USER};
use crate::crypto::{self, KEY_SIZE};
use crate::error::{AppError, AppResult};

const FALLBACK_KEY_FILE: &str = "master.key";

/// Load or create the 32-byte DB encryption key.
/// Prefers OS keyring; falls back to a 0600 file under the config dir.
pub fn resolve_master_key(cfg_dir: &Path) -> AppResult<Vec<u8>> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SVC, KEYRING_USER) {
        if let Ok(stored) = entry.get_password() {
            if let Ok(raw) = STANDARD.decode(stored.trim()) {
                if raw.len() == KEY_SIZE {
                    return Ok(raw);
                }
            }
        }
    }

    let fallback = cfg_dir.join(FALLBACK_KEY_FILE);
    if let Ok(data) = fs::read_to_string(&fallback) {
        if let Ok(raw) = STANDARD.decode(data.trim()) {
            if raw.len() == KEY_SIZE {
                if let Ok(entry) = keyring::Entry::new(KEYRING_SVC, KEYRING_USER) {
                    let _ = entry.set_password(data.trim());
                }
                return Ok(raw);
            }
        }
    }

    let raw = crypto::random_key().map_err(|e| AppError::msg(e.to_string()))?;
    let encoded = STANDARD.encode(raw);

    let mut persisted = false;
    if let Ok(entry) = keyring::Entry::new(KEYRING_SVC, KEYRING_USER) {
        if entry.set_password(&encoded).is_ok() {
            persisted = true;
        }
    }
    write_fallback(&fallback, &encoded)?;
    if !persisted {
        log::warn!("OS keyring unavailable; master key stored in restricted fallback file");
    }
    Ok(raw.to_vec())
}

fn write_fallback(path: &Path, encoded: &str) -> AppResult<()> {
    fs::write(path, encoded)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}
