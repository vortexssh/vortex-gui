use std::time::Duration;

use rand::RngCore;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::error::AppError;

pub struct BrowserAuthResult {
    pub token: String,
    pub email: String,
}

pub async fn browser_login(web_url: &str) -> Result<BrowserAuthResult, AppError> {
    let web_url = web_url.trim().trim_end_matches('/');
    if web_url.is_empty() {
        return Err(AppError::msg(
            "web URL is empty — set Vortex Web URL in settings",
        ));
    }

    let state = random_state(16)?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let login_url = build_login_url(web_url, &redirect_uri, &state)?;

    if let Err(e) = open::that(&login_url) {
        return Err(AppError::msg(format!(
            "open browser: {e} (open manually: {login_url})"
        )));
    }

    let accept = tokio::time::timeout(Duration::from_secs(300), listener.accept());
    let (mut stream, _) = accept
        .await
        .map_err(|_| AppError::msg("login timed out — try again"))??;

    let mut buf = vec![0u8; 8192];
    let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buf))
        .await
        .map_err(|_| AppError::msg("callback read timeout"))??;
    let req = String::from_utf8_lossy(&buf[..n]);
    let first_line = req.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("/");
    let parsed = url::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|_| AppError::msg("invalid callback request"))?;

    let mut q_state = None;
    let mut token = None;
    let mut email = None;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "state" => q_state = Some(v.into_owned()),
            "token" => token = Some(v.into_owned()),
            "email" => email = Some(v.into_owned()),
            _ => {}
        }
    }

    if q_state.as_deref() != Some(state.as_str()) {
        let body = http_error_page("invalid state");
        let _ = stream.write_all(body.as_bytes()).await;
        return Err(AppError::msg("invalid OAuth state"));
    }
    let token = match token.filter(|t| !t.is_empty()) {
        Some(t) => t,
        None => {
            let body = http_error_page("missing token");
            let _ = stream.write_all(body.as_bytes()).await;
            return Err(AppError::msg("callback missing token"));
        }
    };

    let html = r#"HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Connection: close

<!doctype html><html><body style="background:#0a0a0a;color:#39ff14;font-family:'JetBrains Mono',monospace;padding:2rem;display:flex;flex-direction:column;align-items:flex-start;gap:1rem">
<img src="https://raw.githubusercontent.com/vortexssh/vortex-gui/master/logo.svg" width="72" height="72" alt="Vortex" style="border-radius:14px"/>
<h1 style="margin:0">VORTEX</h1><p style="margin:0;color:#9ca3af">Login successful. You can close this tab and return to Vortex GUI.</p>
</body></html>
"#;
    let _ = stream.write_all(html.replace('\n', "\r\n").as_bytes()).await;
    let _ = stream.flush().await;

    Ok(BrowserAuthResult {
        token,
        email: email.unwrap_or_default(),
    })
}

pub fn build_login_url(web_url: &str, redirect_uri: &str, state: &str) -> Result<String, AppError> {
    let mut u = url::Url::parse(web_url)?;
    u.set_path("/login");
    u.set_query(None);
    u.set_fragment(None);
    u.query_pairs_mut()
        .append_pair("client", "vortex-tui")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", state);
    Ok(u.to_string())
}

fn random_state(n: usize) -> Result<String, AppError> {
    let mut b = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut b);
    Ok(hex::encode(b))
}

fn http_error_page(msg: &str) -> String {
    format!(
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n{msg}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_url_device_link() {
        let u = build_login_url(
            "https://my.vortex.timant32.ru",
            "http://127.0.0.1:1234/callback",
            "abc",
        )
        .unwrap();
        assert!(u.starts_with("https://my.vortex.timant32.ru/login?"));
        assert!(u.contains("client=vortex-tui"));
        assert!(u.contains("state=abc"));
        assert!(u.contains("redirect_uri=http"));
    }
}
