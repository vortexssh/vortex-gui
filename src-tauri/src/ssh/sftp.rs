use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use russh::client;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::db::{Host, Secret};
use crate::error::AppError;

use super::auth::authenticate_noninteractive;
use super::session::{dial_ssh, IgnoreHostKey};

const CHUNK: usize = 64 * 1024;

pub struct LiveSftp {
    pub sftp: Arc<SftpSession>,
    _handle: client::Handle<IgnoreHostKey>,
}

pub type SftpMap = HashMap<String, LiveSftp>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: Option<i64>,
    pub mode: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListing {
    pub path: String,
    pub entries: Vec<FsEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConnectResult {
    pub cwd: String,
    pub mode: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    transfer_id: String,
    done: u64,
    total: u64,
    name: String,
    finished: bool,
    error: Option<String>,
}

pub async fn connect(
    host: Host,
    secret: Option<Secret>,
    proxy: bool,
    ws_url: Option<String>,
    web_url: String,
    map: &tokio::sync::Mutex<SftpMap>,
) -> Result<SftpConnectResult, AppError> {
    close(&host.id, map).await;

    let mut handle = dial_ssh(&host, proxy, ws_url.as_deref(), &web_url).await?;
    authenticate_noninteractive(&mut handle, &host.user, secret.as_ref()).await?;

    let channel = handle.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    let cwd = sftp.canonicalize(".").await.unwrap_or_else(|_| ".".into());
    let sftp = Arc::new(sftp);

    {
        let mut g = map.lock().await;
        g.insert(
            host.id.clone(),
            LiveSftp {
                sftp: sftp.clone(),
                _handle: handle,
            },
        );
    }

    Ok(SftpConnectResult {
        cwd,
        mode: if proxy { "proxy".into() } else { "direct".into() },
    })
}

pub async fn close(host_id: &str, map: &tokio::sync::Mutex<SftpMap>) {
    let live = map.lock().await.remove(host_id);
    if let Some(live) = live {
        let _ = live.sftp.close().await;
        drop(live);
    }
}

async fn session(host_id: &str, map: &tokio::sync::Mutex<SftpMap>) -> Result<Arc<SftpSession>, AppError> {
    let g = map.lock().await;
    g.get(host_id)
        .map(|s| s.sftp.clone())
        .ok_or_else(|| AppError::msg("SFTP not connected — open Files and Connect"))
}

pub async fn list(host_id: &str, path: &str, map: &tokio::sync::Mutex<SftpMap>) -> Result<FsListing, AppError> {
    let sftp = session(host_id, map).await?;
    let raw = if path.trim().is_empty() { "." } else { path };
    let resolved = sftp.canonicalize(raw).await.unwrap_or_else(|_| raw.to_string());
    let dir = sftp.read_dir(&resolved).await?;
    let mut entries: Vec<FsEntry> = Vec::new();
    for entry in dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = entry.metadata();
        let is_dir = meta.is_dir();
        entries.push(FsEntry {
            name: name.clone(),
            path: posix_join(&resolved, &name),
            is_dir,
            size: meta.size.unwrap_or(0),
            mtime: meta.mtime.map(|t| i64::from(t)),
            mode: meta.permissions,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(FsListing {
        path: resolved,
        entries,
    })
}

pub async fn mkdir(host_id: &str, path: &str, map: &tokio::sync::Mutex<SftpMap>) -> Result<(), AppError> {
    let sftp = session(host_id, map).await?;
    sftp.create_dir(path).await?;
    Ok(())
}

pub async fn rename(
    host_id: &str,
    from: &str,
    to: &str,
    map: &tokio::sync::Mutex<SftpMap>,
) -> Result<(), AppError> {
    let sftp = session(host_id, map).await?;
    sftp.rename(from, to).await?;
    Ok(())
}

pub async fn remove(
    host_id: &str,
    path: &str,
    is_dir: bool,
    map: &tokio::sync::Mutex<SftpMap>,
) -> Result<(), AppError> {
    let sftp = session(host_id, map).await?;
    if is_dir {
        remove_dir_recursive(&sftp, path).await
    } else {
        sftp.remove_file(path).await?;
        Ok(())
    }
}

async fn remove_dir_recursive(sftp: &SftpSession, path: &str) -> Result<(), AppError> {
    let dir = sftp.read_dir(path).await?;
    for entry in dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = posix_join(path, &name);
        if entry.metadata().is_dir() {
            Box::pin(remove_dir_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(&child).await?;
        }
    }
    sftp.remove_dir(path).await?;
    Ok(())
}

pub async fn transfer(
    app: &AppHandle,
    host_id: &str,
    direction: &str,
    local_path: &str,
    remote_path: &str,
    transfer_id: &str,
    cancel: &CancellationToken,
    map: &tokio::sync::Mutex<SftpMap>,
) -> Result<(), AppError> {
    let sftp = session(host_id, map).await?;
    let local = PathBuf::from(local_path);
    let name = local
        .file_name()
        .or_else(|| Path::new(remote_path).file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| remote_path.to_string());

    let result: Result<bool, AppError> = match direction {
        "put" => put_path(app, &sftp, &local, remote_path, transfer_id, &name, cancel).await,
        "get" => get_path(app, &sftp, remote_path, &local, transfer_id, &name, cancel).await,
        other => Err(AppError::msg(format!("unknown transfer direction: {other}"))),
    };

    match result {
        Ok(cancelled) => {
            if cancelled {
                emit_progress(
                    app,
                    transfer_id,
                    1,
                    1,
                    &name,
                    true,
                    Some("cancelled".to_string()),
                );
            } else {
                emit_progress(app, transfer_id, 1, 1, &name, true, None);
            }
            Ok(())
        }
        Err(e) => {
            emit_progress(
                app,
                transfer_id,
                0,
                1,
                &name,
                true,
                Some(e.to_string()),
            );
            Err(e)
        }
    }
}

async fn put_path(
    app: &AppHandle,
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    transfer_id: &str,
    label: &str,
    cancel: &CancellationToken,
) -> Result<bool, AppError> {
    // When user hits Cancel, we stop after the current chunk.
    // We still emit the final `finished=true` event from `transfer()`.
    let meta = tokio::fs::metadata(local).await?;
    if cancel.is_cancelled() {
        return Ok(true);
    }
    if meta.is_dir() {
        if cancel.is_cancelled() {
            return Ok(true);
        }
        if !sftp.try_exists(remote).await.unwrap_or(false) {
            sftp.create_dir(remote).await?;
        }
        let mut rd = tokio::fs::read_dir(local).await?;
        while let Some(entry) = rd.next_entry().await? {
            if cancel.is_cancelled() {
                return Ok(true);
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let cancelled = Box::pin(put_path(
                app,
                sftp,
                &entry.path(),
                &posix_join(remote, &name),
                transfer_id,
                label,
                cancel,
            ))
            .await?;
            if cancelled {
                return Ok(true);
            }
        }
        return Ok(false);
    }

    let total = meta.len();
    let mut src = tokio::fs::File::open(local).await?;
    let mut dst = sftp.create(remote).await?;
    let mut buf = vec![0u8; CHUNK];
    let mut done = 0u64;
    loop {
        if cancel.is_cancelled() {
            return Ok(true);
        }
        let n = src.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await?;
        done += n as u64;
        if cancel.is_cancelled() {
            return Ok(true);
        }
        emit_progress(app, transfer_id, done, total.max(done), label, false, None);
    }
    dst.flush().await?;
    Ok(false)
}

async fn get_path(
    app: &AppHandle,
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
    transfer_id: &str,
    label: &str,
    cancel: &CancellationToken,
) -> Result<bool, AppError> {
    let meta = sftp.metadata(remote).await?;
    if cancel.is_cancelled() {
        return Ok(true);
    }
    if meta.is_dir() {
        if cancel.is_cancelled() {
            return Ok(true);
        }
        tokio::fs::create_dir_all(local).await?;
        let dir = sftp.read_dir(remote).await?;
        for entry in dir {
            if cancel.is_cancelled() {
                return Ok(true);
            }
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let cancelled = Box::pin(get_path(
                app,
                sftp,
                &posix_join(remote, &name),
                &local.join(&name),
                transfer_id,
                label,
                cancel,
            ))
            .await?;
            if cancelled {
                return Ok(true);
            }
        }
        return Ok(false);
    }

    if let Some(parent) = local.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let total = meta.size.unwrap_or(0);
    let mut src = sftp.open(remote).await?;
    let mut dst = tokio::fs::File::create(local).await?;
    let mut buf = vec![0u8; CHUNK];
    let mut done = 0u64;
    loop {
        if cancel.is_cancelled() {
            return Ok(true);
        }
        let n = src.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await?;
        done += n as u64;
        if cancel.is_cancelled() {
            return Ok(true);
        }
        emit_progress(app, transfer_id, done, total.max(done), label, false, None);
    }
    dst.flush().await?;
    Ok(false)
}

fn emit_progress(
    app: &AppHandle,
    transfer_id: &str,
    done: u64,
    total: u64,
    name: &str,
    finished: bool,
    error: Option<String>,
) {
    let _ = app.emit(
        "sftp-progress",
        ProgressEvent {
            transfer_id: transfer_id.to_string(),
            done,
            total,
            name: name.to_string(),
            finished,
            error,
        },
    );
}

pub fn posix_join(parent: &str, name: &str) -> String {
    let parent = parent.trim_end_matches('/');
    if parent.is_empty() || parent == "." {
        format!("/{name}").replace("//", "/")
    } else {
        format!("{parent}/{name}")
    }
}

#[allow(dead_code)]
pub fn system_mtime(t: SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::posix_join;

    #[test]
    fn posix_join_root() {
        assert_eq!(posix_join("/", "etc"), "/etc");
        assert_eq!(posix_join("/home", "tim"), "/home/tim");
    }
}
