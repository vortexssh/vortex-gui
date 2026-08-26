//! Cloud URL discovery via getjson mirrors (ping race).
//!
//! GET `https://getjson.{domain}/c/vortex` →
//! `{"actual":{"url":{"info":"...","backend":"...","frontend":"..."}}}`

use std::time::{Duration, Instant};

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};

use crate::config::{self, DEFAULT_CORE_URL, DEFAULT_WEB_URL};
use crate::error::{AppError, AppResult};

/// Mirror hostnames for `https://getjson.{domain}/c/vortex`.
/// First listed is preferred on equal latency; `timant32.ru` is a reserve path.
pub const GETJSON_MIRRORS: &[&str] = &["vicrorege.com", "timant32.ru"];

const GETJSON_PATH: &str = "/c/vortex";
const MIRROR_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredUrls {
    pub core_url: String,
    pub web_url: String,
    pub info_url: String,
    pub mirror: String,
    pub latency_ms: u64,
}

#[derive(Debug, Deserialize)]
struct GetjsonRoot {
    actual: GetjsonActual,
}

#[derive(Debug, Deserialize)]
struct GetjsonActual {
    url: GetjsonUrl,
}

#[derive(Debug, Deserialize)]
struct GetjsonUrl {
    info: String,
    backend: String,
    frontend: String,
}

pub fn getjson_url(domain: &str) -> String {
    format!("https://getjson.{domain}{GETJSON_PATH}")
}

/// True when stored URLs are empty or still the compile-time stock defaults
/// (user has not customized them).
pub fn urls_are_stock(core_url: &str, web_url: &str) -> bool {
    is_stock_url(core_url, DEFAULT_CORE_URL) && is_stock_url(web_url, DEFAULT_WEB_URL)
}

fn is_stock_url(stored: &str, default: &str) -> bool {
    let v = stored.trim().trim_end_matches('/');
    if v.is_empty() {
        return true;
    }
    let d = default.trim().trim_end_matches('/');
    normalize_https(v) == normalize_https(d)
}

fn normalize_https(raw: &str) -> String {
    let t = raw.trim().trim_end_matches('/');
    if t.is_empty() {
        return String::new();
    }
    if t.starts_with("http://") || t.starts_with("https://") {
        t.to_string()
    } else {
        format!("https://{t}")
    }
}

fn parse_payload(body: &str, mirror: &str, latency_ms: u64) -> AppResult<DiscoveredUrls> {
    let root: GetjsonRoot = serde_json::from_str(body).map_err(|e| {
        AppError::msg(format!("getjson.{mirror}: invalid JSON ({e})"))
    })?;
    let u = root.actual.url;
    let core = normalize_https(&u.backend);
    let web = normalize_https(&u.frontend);
    let info = normalize_https(&u.info);
    if core.is_empty() || web.is_empty() {
        return Err(AppError::msg(format!(
            "getjson.{mirror}: missing backend/frontend"
        )));
    }
    Ok(DiscoveredUrls {
        core_url: core,
        web_url: web,
        info_url: info,
        mirror: mirror.to_string(),
        latency_ms,
    })
}

async fn probe_mirror(domain: &str) -> AppResult<DiscoveredUrls> {
    let url = getjson_url(domain);
    let client = reqwest::Client::builder()
        .timeout(MIRROR_TIMEOUT)
        .user_agent(format!("vortex-gui/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::msg(e.to_string()))?;

    let started = Instant::now();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("getjson.{domain}: {e}")))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::msg(format!("getjson.{domain}: {e}")))?;
    let latency_ms = started.elapsed().as_millis() as u64;
    if !status.is_success() {
        return Err(AppError::msg(format!(
            "getjson.{domain}: HTTP {status}"
        )));
    }
    parse_payload(&body, domain, latency_ms)
}

/// Race all mirrors; pick the fastest successful response.
pub async fn discover_urls() -> AppResult<DiscoveredUrls> {
    let futs = GETJSON_MIRRORS
        .iter()
        .map(|d| async move { (*d, probe_mirror(d).await) });
    let results = join_all(futs).await;

    let mut best: Option<DiscoveredUrls> = None;
    let mut errors: Vec<String> = Vec::new();

    for (domain, res) in results {
        match res {
            Ok(d) => {
                let take = match &best {
                    None => true,
                    Some(b) => d.latency_ms < b.latency_ms,
                };
                if take {
                    best = Some(d);
                }
            }
            Err(e) => errors.push(format!("{domain}: {e}")),
        }
    }

    best.ok_or_else(|| {
        AppError::msg(format!(
            "all getjson mirrors failed ({})",
            if errors.is_empty() {
                "no mirrors".into()
            } else {
                errors.join("; ")
            }
        ))
    })
}

/// Discover and apply only when stored URLs are still stock defaults.
/// Returns `Some` when settings were updated.
pub async fn refresh_if_stock(
    core_url: &str,
    web_url: &str,
) -> AppResult<Option<DiscoveredUrls>> {
    if !urls_are_stock(core_url, web_url) {
        return Ok(None);
    }
    match discover_urls().await {
        Ok(d) => Ok(Some(d)),
        Err(e) => {
            log::warn!("getjson discover skipped: {e}");
            Ok(None)
        }
    }
}

#[allow(dead_code)]
pub fn fallback_urls() -> DiscoveredUrls {
    DiscoveredUrls {
        core_url: config::DEFAULT_CORE_URL.to_string(),
        web_url: config::DEFAULT_WEB_URL.to_string(),
        info_url: "https://vortex.timant32.ru".into(),
        mirror: "builtin".into(),
        latency_ms: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sample() {
        let raw = r#"{"actual":{"url":{"info":"vortex.timant32.ru","backend":"api.vortex.timant32.ru","frontend":"my.vortex.timant32.ru"}}}"#;
        let d = parse_payload(raw, "vicrorege.com", 12).unwrap();
        assert_eq!(d.core_url, "https://api.vortex.timant32.ru");
        assert_eq!(d.web_url, "https://my.vortex.timant32.ru");
        assert_eq!(d.info_url, "https://vortex.timant32.ru");
        assert_eq!(d.mirror, "vicrorege.com");
    }

    #[test]
    fn stock_detection() {
        assert!(urls_are_stock("", ""));
        assert!(urls_are_stock(DEFAULT_CORE_URL, DEFAULT_WEB_URL));
        assert!(urls_are_stock(
            "https://api.vortex.timant32.ru/",
            "https://my.vortex.timant32.ru"
        ));
        assert!(!urls_are_stock("https://localhost:8000", DEFAULT_WEB_URL));
    }

    #[test]
    fn mirror_urls() {
        assert_eq!(
            getjson_url("vicrorege.com"),
            "https://getjson.vicrorege.com/c/vortex"
        );
        assert_eq!(
            getjson_url("timant32.ru"),
            "https://getjson.timant32.ru/c/vortex"
        );
    }
}
