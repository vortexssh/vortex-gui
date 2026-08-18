use std::path::PathBuf;
use std::sync::Arc;

use russh::client::{self, AuthResult, KeyboardInteractiveAuthResponse};
use russh::keys::agent::client::AgentClient;
use russh::keys::{decode_secret_key, load_secret_key, PrivateKey, PrivateKeyWithHashAlg};
use russh::{MethodKind, MethodSet};
use tauri::AppHandle;
use tokio::sync::{mpsc, watch};

use crate::db::{AuthType, Secret};
use crate::error::AppError;

use super::session::{emit_data, IgnoreHostKey};

/// Standard SSH userauth: stored password/key if present, otherwise
/// ssh-agent → ~/.ssh identities → keyboard-interactive / password prompt.
pub async fn authenticate(
    handle: &mut client::Handle<IgnoreHostKey>,
    user: &str,
    secret: Option<&Secret>,
    stdin_rx: &mut mpsc::Receiver<Vec<u8>>,
    close_rx: &mut watch::Receiver<bool>,
    app: &AppHandle,
    session_id: &str,
) -> Result<(), AppError> {
    let user = if user.is_empty() { "root" } else { user };

    if let Some(sec) = secret.filter(|s| !s.payload.trim().is_empty()) {
        match sec.auth_type {
            AuthType::Password => {
                let auth = handle.authenticate_password(user, sec.payload.trim()).await?;
                if auth.success() {
                    return Ok(());
                }
            }
            AuthType::PrivateKey => {
                let key = load_identity(sec.payload.trim())?;
                if try_private_key(handle, user, key).await? {
                    return Ok(());
                }
                return Err(AppError::msg("SSH public-key authentication failed"));
            }
        }
    }

    let probe = handle.authenticate_none(user).await?;
    if probe.success() {
        return Ok(());
    }
    let mut remaining = remaining_of(&probe);

    if remaining.is_empty() || remaining.contains(&MethodKind::PublicKey) {
        if try_agent(handle, user).await? {
            return Ok(());
        }
        if try_default_files(handle, user).await? {
            return Ok(());
        }
    }

    if remaining.is_empty() || remaining.contains(&MethodKind::KeyboardInteractive) {
        match try_keyboard_interactive(handle, user, stdin_rx, close_rx, app, session_id).await? {
            KbdResult::Success => return Ok(()),
            KbdResult::Failure(methods) => remaining = methods,
        }
    }

    if remaining.is_empty() || remaining.contains(&MethodKind::Password) {
        emit_text(app, session_id, "Password: ");
        let pw = read_auth_line(stdin_rx, close_rx, false, app, session_id).await?;
        emit_text(app, session_id, "\r\n");
        let auth = handle.authenticate_password(user, pw).await?;
        if auth.success() {
            return Ok(());
        }
    }

    Err(AppError::msg(
        "SSH authentication failed — agent, ~/.ssh keys, and interactive prompt were tried",
    ))
}

/// Same as [`authenticate`] but never prompts (no PTY). Used by SFTP.
pub async fn authenticate_noninteractive(
    handle: &mut client::Handle<IgnoreHostKey>,
    user: &str,
    secret: Option<&Secret>,
) -> Result<(), AppError> {
    let user = if user.is_empty() { "root" } else { user };

    if let Some(sec) = secret.filter(|s| !s.payload.trim().is_empty()) {
        match sec.auth_type {
            AuthType::Password => {
                let auth = handle.authenticate_password(user, sec.payload.trim()).await?;
                if auth.success() {
                    return Ok(());
                }
            }
            AuthType::PrivateKey => {
                let key = load_identity(sec.payload.trim())?;
                if try_private_key(handle, user, key).await? {
                    return Ok(());
                }
                return Err(AppError::msg("SSH public-key authentication failed"));
            }
        }
    }

    let probe = handle.authenticate_none(user).await?;
    if probe.success() {
        return Ok(());
    }
    let remaining = remaining_of(&probe);

    if remaining.is_empty() || remaining.contains(&MethodKind::PublicKey) {
        if try_agent(handle, user).await? {
            return Ok(());
        }
        if try_default_files(handle, user).await? {
            return Ok(());
        }
    }

    Err(AppError::msg(
        "SFTP auth failed — save a password or key on the host, or load ssh-agent / ~/.ssh",
    ))
}

enum KbdResult {
    Success,
    Failure(MethodSet),
}

fn remaining_of(auth: &AuthResult) -> MethodSet {
    match auth {
        AuthResult::Success => MethodSet::empty(),
        AuthResult::Failure {
            remaining_methods, ..
        } => remaining_methods.clone(),
    }
}

async fn try_private_key(
    handle: &mut client::Handle<IgnoreHostKey>,
    user: &str,
    key: PrivateKey,
) -> Result<bool, AppError> {
    let hash = handle.best_supported_rsa_hash().await?.flatten();
    let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
    Ok(handle.authenticate_publickey(user, key).await?.success())
}

async fn try_agent(handle: &mut client::Handle<IgnoreHostKey>, user: &str) -> Result<bool, AppError> {
    #[cfg(unix)]
    {
        let mut agent = match AgentClient::connect_env().await {
            Ok(a) => a,
            Err(_) => return Ok(false),
        };
        let ids = match agent.request_identities().await {
            Ok(v) => v,
            Err(_) => return Ok(false),
        };
        let hash = handle.best_supported_rsa_hash().await?.flatten();
        for pk in ids {
            match handle
                .authenticate_publickey_with(user, pk, hash, &mut agent)
                .await
            {
                Ok(auth) if auth.success() => return Ok(true),
                _ => continue,
            }
        }
        Ok(false)
    }
    #[cfg(not(unix))]
    {
        let _ = (handle, user);
        Ok(false)
    }
}

async fn try_default_files(
    handle: &mut client::Handle<IgnoreHostKey>,
    user: &str,
) -> Result<bool, AppError> {
    let Some(dir) = dirs::home_dir().map(|h| h.join(".ssh")) else {
        return Ok(false);
    };
    for name in ["id_ed25519", "id_ecdsa", "id_rsa", "id_ed25519_sk"] {
        let path = dir.join(name);
        if !path.is_file() {
            continue;
        }
        let Ok(key) = load_secret_key(&path, None) else {
            continue;
        };
        if try_private_key(handle, user, key).await? {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn try_keyboard_interactive(
    handle: &mut client::Handle<IgnoreHostKey>,
    user: &str,
    stdin_rx: &mut mpsc::Receiver<Vec<u8>>,
    close_rx: &mut watch::Receiver<bool>,
    app: &AppHandle,
    session_id: &str,
) -> Result<KbdResult, AppError> {
    let mut resp = handle
        .authenticate_keyboard_interactive_start(user, None)
        .await?;
    loop {
        match resp {
            KeyboardInteractiveAuthResponse::Success => return Ok(KbdResult::Success),
            KeyboardInteractiveAuthResponse::Failure {
                remaining_methods, ..
            } => return Ok(KbdResult::Failure(remaining_methods)),
            KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                if !name.is_empty() {
                    emit_text(app, session_id, &format!("{name}\r\n"));
                }
                if !instructions.is_empty() {
                    emit_text(app, session_id, &format!("{instructions}\r\n"));
                }
                let mut answers = Vec::new();
                for p in prompts {
                    emit_text(app, session_id, &p.prompt);
                    let line =
                        read_auth_line(stdin_rx, close_rx, p.echo, app, session_id).await?;
                    answers.push(line);
                    emit_text(app, session_id, "\r\n");
                }
                resp = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await?;
            }
        }
    }
}

fn load_identity(payload: &str) -> Result<PrivateKey, AppError> {
    if payload.contains("-----BEGIN") {
        return decode_secret_key(payload, None)
            .map_err(|e| AppError::msg(format!("parse private key: {e}")));
    }
    let path = expand_home(payload);
    load_secret_key(&path, None).map_err(|e| {
        AppError::msg(format!(
            "read private key {}: {e}",
            path.display()
        ))
    })
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

fn emit_text(app: &AppHandle, session_id: &str, text: &str) {
    emit_data(app, session_id, text.as_bytes());
}

async fn read_auth_line(
    stdin: &mut mpsc::Receiver<Vec<u8>>,
    close_rx: &mut watch::Receiver<bool>,
    echo: bool,
    app: &AppHandle,
    session_id: &str,
) -> Result<String, AppError> {
    let mut buf = Vec::new();
    loop {
        tokio::select! {
            _ = close_rx.changed() => {
                if *close_rx.borrow() {
                    return Err(AppError::msg("session closed during authentication"));
                }
            }
            chunk = stdin.recv() => {
                let Some(chunk) = chunk else {
                    return Err(AppError::msg("session closed during authentication"));
                };
                for b in chunk {
                    match b {
                        b'\r' | b'\n' => {
                            return Ok(String::from_utf8_lossy(&buf).into_owned());
                        }
                        0x7f | 0x08 => {
                            if buf.pop().is_some() && echo {
                                emit_text(app, session_id, "\x08 \x08");
                            }
                        }
                        c if c >= 32 || c == b'\t' => {
                            buf.push(c);
                            if echo {
                                emit_data(app, session_id, &[c]);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}
