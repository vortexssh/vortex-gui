use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use russh::client;
use russh::{ChannelMsg, Disconnect};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, watch};

use crate::db::{Host, Secret};
use crate::error::AppError;

use super::proxy::dial_proxy;

pub struct LiveSession {
    pub stdin: mpsc::Sender<Vec<u8>>,
    pub resize: mpsc::Sender<(u32, u32)>,
    pub close: watch::Sender<bool>,
}

pub type SessionMap = HashMap<String, LiveSession>;

pub(crate) struct IgnoreHostKey;

impl client::Handler for IgnoreHostKey {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Parity with TUI ssh.InsecureIgnoreHostKey — known_hosts comes later.
        Ok(true)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshDataEvent {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshExitEvent {
    session_id: String,
    message: String,
}

pub struct ConnectParams {
    pub host: Host,
    pub secret: Option<Secret>,
    pub cols: u32,
    pub rows: u32,
    pub proxy: bool,
    pub ws_url: Option<String>,
    pub web_url: String,
}

pub async fn start_session(
    app: AppHandle,
    params: ConnectParams,
    sessions: Arc<tokio::sync::Mutex<SessionMap>>,
) -> Result<String, AppError> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let (stdin_tx, stdin_rx) = mpsc::channel::<Vec<u8>>(64);
    let (resize_tx, resize_rx) = mpsc::channel::<(u32, u32)>(8);
    let (close_tx, close_rx) = watch::channel(false);

    {
        let mut map = sessions.lock().await;
        map.insert(
            session_id.clone(),
            LiveSession {
                stdin: stdin_tx,
                resize: resize_tx,
                close: close_tx,
            },
        );
    }

    let sid = session_id.clone();
    let sessions_clone = sessions.clone();
    tokio::spawn(async move {
        let result = run_session(app.clone(), sid.clone(), params, stdin_rx, resize_rx, close_rx).await;
        let message = match result {
            Ok(()) => "session closed".to_string(),
            Err(e) => e.to_string(),
        };
        let _ = app.emit(
            "ssh-exit",
            SshExitEvent {
                session_id: sid.clone(),
                message,
            },
        );
        sessions_clone.lock().await.remove(&sid);
    });

    Ok(session_id)
}

async fn run_session(
    app: AppHandle,
    session_id: String,
    params: ConnectParams,
    mut stdin_rx: mpsc::Receiver<Vec<u8>>,
    mut resize_rx: mpsc::Receiver<(u32, u32)>,
    mut close_rx: watch::Receiver<bool>,
) -> Result<(), AppError> {
    let mut handle = dial_ssh(
        &params.host,
        params.proxy,
        params.ws_url.as_deref(),
        &params.web_url,
    )
    .await?;

    super::auth::authenticate(
        &mut handle,
        &params.host.user,
        params.secret.as_ref(),
        &mut stdin_rx,
        &mut close_rx,
        &app,
        &session_id,
    )
    .await?;

    let mut channel = handle.channel_open_session().await?;
    let cols = if params.cols == 0 { 80 } else { params.cols };
    let rows = if params.rows == 0 { 24 } else { params.rows };
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await?;
    channel.request_shell(true).await?;

    loop {
        tokio::select! {
            biased;
            _ = close_rx.changed() => {
                if *close_rx.borrow() {
                    break;
                }
            }
            Some(bytes) = stdin_rx.recv() => {
                if !bytes.is_empty() {
                    channel.data(&bytes[..]).await?;
                }
            }
            Some((c, r)) = resize_rx.recv() => {
                let _ = channel.window_change(c, r, 0, 0).await;
            }
            msg = channel.wait() => {
                match msg {
                    None => break,
                    Some(ChannelMsg::Data { ref data }) => {
                        emit_data(&app, &session_id, data);
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        emit_data(&app, &session_id, data);
                    }
                    Some(ChannelMsg::Eof | ChannelMsg::Close) => break,
                    Some(ChannelMsg::ExitStatus { .. } | ChannelMsg::ExitSignal { .. }) => break,
                    Some(_) => {}
                }
            }
        }
    }

    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
    Ok(())
}

pub async fn dial_ssh(
    host: &Host,
    proxy: bool,
    ws_url: Option<&str>,
    web_url: &str,
) -> Result<client::Handle<IgnoreHostKey>, AppError> {
    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        ..<_>::default()
    });
    if proxy {
        let url = ws_url.ok_or_else(|| AppError::msg("proxy URL missing"))?;
        let stream = dial_proxy(url, web_url).await?;
        Ok(client::connect_stream(config, stream, IgnoreHostKey).await?)
    } else {
        let addr = host.address.trim();
        if addr.is_empty() {
            return Err(AppError::msg(
                "host address is empty (direct mode requires IP/hostname)",
            ));
        }
        let port = if host.port == 0 { 22 } else { host.port as u16 };
        Ok(client::connect(config, (addr, port), IgnoreHostKey).await?)
    }
}

pub(super) fn emit_data(app: &AppHandle, session_id: &str, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    let _ = app.emit(
        "ssh-data",
        SshDataEvent {
            session_id: session_id.to_string(),
            data: B64.encode(data),
        },
    );
}

#[allow(dead_code)]
pub async fn write_session(sessions: &SessionMap, id: &str, data: Vec<u8>) -> Result<(), AppError> {
    let s = sessions.get(id).ok_or_else(|| AppError::msg("session not found"))?;
    s.stdin
        .send(data)
        .await
        .map_err(|_| AppError::msg("session closed"))?;
    Ok(())
}

pub fn resize_session(sessions: &SessionMap, id: &str, cols: u32, rows: u32) -> Result<(), AppError> {
    let s = sessions.get(id).ok_or_else(|| AppError::msg("session not found"))?;
    s.resize
        .try_send((cols, rows))
        .map_err(|_| AppError::msg("session closed"))?;
    Ok(())
}

pub fn close_session(sessions: &SessionMap, id: &str) -> Result<(), AppError> {
    let s = sessions.get(id).ok_or_else(|| AppError::msg("session not found"))?;
    let _ = s.close.send(true);
    Ok(())
}
