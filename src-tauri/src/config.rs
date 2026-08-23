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

/// Interactive SSH launcher (TUI parity). Default `ssh`; e.g. `kitty +kitten ssh`.
pub fn effective_ssh_command(stored: &str) -> String {
    let v = stored.trim();
    if v.is_empty() {
        "ssh".into()
    } else {
        v.to_string()
    }
}

/// Which OS terminal launches External / provided-layout Connect.
pub fn normalize_system_terminal(raw: &str) -> String {
    match raw.trim() {
        "kitty" | "wezterm" | "alacritty" | "ghostty" | "konsole" | "gnome-terminal" | "custom" => {
            raw.trim().to_string()
        }
        _ => "kitty".into(),
    }
}

/// Resolve launcher argv prefix from preset (+ custom override).
pub fn resolve_ssh_command(system_terminal: &str, custom: &str) -> String {
    match normalize_system_terminal(system_terminal).as_str() {
        "wezterm" => "wezterm ssh".into(),
        "alacritty" => "alacritty -e ssh".into(),
        "ghostty" => "ghostty -e ssh".into(),
        "konsole" => "konsole -e ssh".into(),
        "gnome-terminal" => "gnome-terminal -- ssh".into(),
        "custom" => effective_ssh_command(custom),
        // kitty (default)
        _ => "kitty +kitten ssh".into(),
    }
}

/// Infer preset from a previously saved freeform command (migration / UX).
pub fn infer_system_terminal(command: &str) -> String {
    let c = effective_ssh_command(command);
    match c.as_str() {
        "kitty +kitten ssh" | "kitty ssh" => "kitty".into(),
        "wezterm ssh" => "wezterm".into(),
        "alacritty -e ssh" => "alacritty".into(),
        "ghostty -e ssh" => "ghostty".into(),
        "konsole -e ssh" => "konsole".into(),
        "gnome-terminal -- ssh" => "gnome-terminal".into(),
        "ssh" => "custom".into(),
        _ => "custom".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_presets() {
        assert_eq!(resolve_ssh_command("kitty", ""), "kitty +kitten ssh");
        assert_eq!(resolve_ssh_command("wezterm", "ignored"), "wezterm ssh");
        assert_eq!(resolve_ssh_command("custom", "foot ssh"), "foot ssh");
        assert_eq!(resolve_ssh_command("custom", ""), "ssh");
    }

    #[test]
    fn infer_from_command() {
        assert_eq!(infer_system_terminal("kitty +kitten ssh"), "kitty");
        assert_eq!(infer_system_terminal("weird"), "custom");
    }
}
