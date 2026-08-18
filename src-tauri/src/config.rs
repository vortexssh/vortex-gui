use std::path::PathBuf;

pub const APP_NAME: &str = "vortex-gui";
pub const KEYRING_SVC: &str = "vortex-gui";
pub const KEYRING_USER: &str = "db-master-key";

pub const DEFAULT_WEB_URL: &str = "https://my.vortex.timant32.ru";
pub const DEFAULT_CORE_URL: &str = "https://api.vortex.timant32.ru";

#[derive(Clone, Debug)]
pub struct Paths {
    pub config_dir: PathBuf,
    pub db_path: PathBuf,
    #[allow(dead_code)]
    pub log_path: PathBuf,
}

impl Paths {
    pub fn resolve() -> Result<Self, std::io::Error> {
        let home = dirs::home_dir().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "home directory not found")
        })?;
        let config_dir = home.join(".config").join(APP_NAME);
        Ok(Self {
            db_path: config_dir.join("vortex.db"),
            log_path: config_dir.join("vortex.log"),
            config_dir,
        })
    }
}

pub fn ensure_dir(dir: &std::path::Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

pub fn effective_web_url(stored: &str) -> String {
    let v = stored.trim();
    if v.is_empty() {
        DEFAULT_WEB_URL.to_string()
    } else {
        v.trim_end_matches('/').to_string()
    }
}

pub fn effective_core_url(stored: &str) -> String {
    let v = stored.trim();
    if v.is_empty() {
        DEFAULT_CORE_URL.to_string()
    } else {
        v.trim_end_matches('/').to_string()
    }
}
