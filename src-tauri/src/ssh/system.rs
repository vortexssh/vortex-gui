//! Configurable system SSH launcher (TUI parity: `ssh` / `kitty +kitten ssh` / …).

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::db::{AuthType, Host, Secret};
use crate::error::AppError;

/// Parse `"kitty +kitten ssh"` → bin=`kitty`, prefix=`["+kitten", "ssh"]`.
pub fn split_ssh_command(command: &str) -> Result<(String, Vec<String>), AppError> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    let parts = if parts.is_empty() {
        vec!["ssh"]
    } else {
        parts
    };
    let bin = parts[0].to_string();
    if bin.is_empty() {
        return Err(AppError::msg("ssh command is empty"));
    }
    let prefix = parts[1..].iter().map(|s| (*s).to_string()).collect();
    Ok((bin, prefix))
}

fn expand_home(p: &str) -> PathBuf {
    if p == "~" || p.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            if p == "~" {
                return home;
            }
            return home.join(p.trim_start_matches("~/"));
        }
    }
    PathBuf::from(p)
}

/// PEM → temp file (0600); path/`~/…` → expanded path. Returns (path, cleanup).
fn prepare_identity(payload: &str) -> Result<(PathBuf, Option<PathBuf>), AppError> {
    let payload = payload.trim();
    if payload.is_empty() {
        return Err(AppError::msg("empty private key"));
    }
    if payload.contains("-----BEGIN") {
        let dir = tempfile::tempdir().map_err(|e| AppError::msg(e.to_string()))?;
        let path = dir.path().join("id_key");
        fs::write(&path, format!("{payload}\n"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }
        // Keep tempdir alive by leaking into owned PathBuf parent cleanup via remove_dir_all.
        let keep = dir.keep();
        Ok((keep.join("id_key"), Some(keep)))
    } else {
        Ok((expand_home(payload), None))
    }
}

fn write_askpass() -> Result<(PathBuf, PathBuf), AppError> {
    let dir = tempfile::tempdir().map_err(|e| AppError::msg(e.to_string()))?;
    let path = dir.path().join("askpass.sh");
    fs::write(&path, "#!/bin/sh\nprintf '%s\\n' \"$VORTEX_SSH_PASSWORD\"\n")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
    }
    let keep = dir.keep();
    Ok((keep.join("askpass.sh"), keep))
}

/// Spawn the configured SSH launcher for a **direct** host (detached).
/// Secrets stay in-process / temp files — never sent to Core.
pub fn spawn_system_ssh(
    command: &str,
    host: &Host,
    secret: Option<&Secret>,
) -> Result<(), AppError> {
    let addr = host.address.trim();
    if addr.is_empty() {
        return Err(AppError::msg(
            "host address is empty — external SSH needs a direct IP/hostname",
        ));
    }
    if host.proxy_enabled {
        return Err(AppError::msg(
            "external SSH is for direct hosts only — use in-app Connect for Vortex Proxy",
        ));
    }

    let (bin, prefix) = split_ssh_command(command)?;
    let mut args = prefix;
    args.push("-tt".into());
    let port = if host.port == 0 { 22 } else { host.port };
    args.push("-p".into());
    args.push(port.to_string());

    let mut cleanup_dirs: Vec<PathBuf> = Vec::new();
    let mut identity: Option<PathBuf> = None;
    let mut password: Option<String> = None;

    if let Some(sec) = secret.filter(|s| !s.payload.trim().is_empty()) {
        match sec.auth_type {
            AuthType::PrivateKey => {
                let (path, dir) = prepare_identity(&sec.payload)?;
                if let Some(d) = dir {
                    cleanup_dirs.push(d);
                }
                identity = Some(path);
            }
            AuthType::Password => {
                password = Some(sec.payload.trim().to_string());
            }
        }
    }

    if let Some(ref id) = identity {
        args.push("-i".into());
        args.push(id.to_string_lossy().into_owned());
    }

    let user = if host.user.trim().is_empty() {
        "root"
    } else {
        host.user.trim()
    };
    args.push(format!("{user}@{addr}"));

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(pw) = password {
        let (askpass, ask_dir) = write_askpass()?;
        cleanup_dirs.push(ask_dir);
        cmd.env("SSH_ASKPASS", &askpass);
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
        cmd.env("VORTEX_SSH_PASSWORD", pw);
        if std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_none() {
            cmd.env("DISPLAY", ":0");
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::msg(format!("failed to start `{bin}`: {e}")))?;

    // Clean temp key/askpass after the child exits (or after a short grace if wait fails).
    std::thread::spawn(move || {
        let _ = child.wait();
        for d in cleanup_dirs {
            let _ = fs::remove_dir_all(d);
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::split_ssh_command;

    #[test]
    fn split_plain_ssh() {
        let (bin, prefix) = split_ssh_command("ssh").unwrap();
        assert_eq!(bin, "ssh");
        assert!(prefix.is_empty());
    }

    #[test]
    fn split_kitty() {
        let (bin, prefix) = split_ssh_command("kitty +kitten ssh").unwrap();
        assert_eq!(bin, "kitty");
        assert_eq!(prefix, vec!["+kitten", "ssh"]);
    }

    #[test]
    fn split_empty_defaults() {
        let (bin, prefix) = split_ssh_command("  ").unwrap();
        assert_eq!(bin, "ssh");
        assert!(prefix.is_empty());
    }
}
