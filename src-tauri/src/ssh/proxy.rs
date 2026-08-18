use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio_tungstenite::tungstenite::Message;

use crate::error::AppError;

#[derive(serde::Deserialize)]
struct ProxyReady {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    session_id: String,
}

/// Dial Core `/ws/proxy/{id}` and return a stream of raw SSH bytes after `proxy_ready`.
pub async fn dial_proxy(ws_url: &str, web_url: &str) -> Result<DuplexStream, AppError> {
    let connect = tokio_tungstenite::connect_async(ws_url);
    let (mut ws, _) = tokio::time::timeout(Duration::from_secs(15), connect)
        .await
        .map_err(|_| AppError::msg("proxy dial timeout"))?
        .map_err(|e| map_ws_err(&e.to_string(), web_url))?;

    let first = tokio::time::timeout(Duration::from_secs(15), ws.next())
        .await
        .map_err(|_| AppError::msg("proxy handshake timeout"))?
        .ok_or_else(|| AppError::msg("proxy closed during handshake"))?
        .map_err(|e| map_ws_err(&e.to_string(), web_url))?;

    let text = match first {
        Message::Text(t) => t.to_string(),
        Message::Binary(b) => String::from_utf8_lossy(&b).into_owned(),
        Message::Close(frame) => {
            let reason = frame
                .as_ref()
                .map(|f| f.reason.to_string())
                .unwrap_or_default();
            return Err(map_ws_err(&reason, web_url));
        }
        other => {
            return Err(AppError::msg(format!(
                "expected proxy_ready, got {other:?}"
            )));
        }
    };

    match serde_json::from_str::<ProxyReady>(&text) {
        Ok(ready) if ready.kind == "proxy_ready" => {
            let _ = ready.session_id;
        }
        Ok(ready) if ready.kind == "proxy_error" || ready.kind == "error" => {
            return Err(map_ws_err(&text, web_url));
        }
        _ => {
            return Err(AppError::msg(format!(
                "expected proxy_ready, got {text}"
            )));
        }
    }

    let (local, remote) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        if let Err(e) = pump(ws, local).await {
            log::debug!("proxy pump ended: {e}");
        }
    });
    Ok(remote)
}

async fn pump<S>(
    mut ws: tokio_tungstenite::WebSocketStream<S>,
    mut local: DuplexStream,
) -> Result<(), AppError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut buf = vec![0u8; 32 * 1024];
    loop {
        tokio::select! {
            msg = ws.next() => {
                match msg {
                    None => break,
                    Some(Err(_)) => break,
                    Some(Ok(Message::Binary(data))) => {
                        if local.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(t))) => {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                            if matches!(v.get("type").and_then(|x| x.as_str()), Some("proxy_error" | "error")) {
                                break;
                            }
                        }
                        if local.write_all(t.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Frame(_))) => {}
                }
            }
            n = local.read(&mut buf) => {
                match n {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if ws.send(Message::Binary(buf[..n].to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }
    let _ = ws.close(None).await;
    Ok(())
}

pub fn map_ws_err(msg: &str, web_url: &str) -> AppError {
    let l = msg.to_ascii_lowercase();
    if l.contains("1008")
        || l.contains("2fa")
        || l.contains("totp")
        || l.contains("two-factor")
        || l.contains("two factor")
    {
        return AppError::two_fa(
            "Proxy and telemetry require 2FA. Enable TOTP in the Vortex cabinet — GUI will not bypass it.",
            web_url,
        );
    }
    if l.contains("1013") || l.contains("offline") {
        return AppError::msg("agent offline");
    }
    AppError::msg(format!("proxy: {msg}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_1008_to_2fa() {
        let e = map_ws_err("WebSocket protocol error: 1008", "https://my.vortex.timant32.ru");
        let s = serde_json::to_value(&e).unwrap();
        assert_eq!(s["code"], "2fa_required");
        assert!(s["web2faUrl"].as_str().unwrap().ends_with("/security/2fa"));
    }
}
