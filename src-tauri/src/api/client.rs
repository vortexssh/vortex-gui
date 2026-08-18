use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::models::{CloudHost, HostBilling, Telemetry, UserMe};
use crate::error::{AppError, AppResult};

const FORBIDDEN_ALWAYS: &[&str] = &["private_key", "ssh_key", "passphrase", "secret_payload"];
const FORBIDDEN_ON_HOSTS: &[&str] = &["password", "secret"];

#[derive(Clone)]
pub struct Client {
    pub base_url: String,
    pub token: String,
    pub web_url: String,
    http: reqwest::Client,
}

impl Client {
    pub fn new(base_url: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            token: token.into().trim().to_string(),
            web_url: String::new(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
        }
    }

    pub fn with_web_url(mut self, web_url: impl Into<String>) -> Self {
        self.web_url = web_url.into();
        self
    }

    pub async fn whoami(&self) -> AppResult<UserMe> {
        #[derive(Deserialize)]
        struct Raw {
            id: String,
            email: String,
            #[serde(default)]
            is_2fa_enabled: bool,
            #[serde(default)]
            require_2fa: Option<bool>,
        }
        let raw: Raw = self.get("/api/v1/users/me").await?;
        Ok(UserMe {
            id: raw.id,
            email: raw.email,
            is_2fa_enabled: raw.is_2fa_enabled,
            require_2fa: raw.require_2fa.unwrap_or(true),
        })
    }

    pub async fn health(&self) -> AppResult<()> {
        let _: Value = self.get("/api/v1/health").await?;
        Ok(())
    }

    pub async fn list_hosts(&self) -> AppResult<Vec<CloudApiHost>> {
        self.get("/api/v1/hosts").await
    }

    pub async fn create_host(&self, body: HostWrite) -> AppResult<CloudApiHost> {
        self.send(reqwest::Method::POST, "/api/v1/hosts", Some(&body))
            .await
    }

    pub async fn update_host(&self, id: &str, body: HostPatch) -> AppResult<CloudApiHost> {
        let path = format!("/api/v1/hosts/{}", urlencoding_path(id));
        self.send(reqwest::Method::PATCH, &path, Some(&body)).await
    }

    pub async fn delete_host(&self, id: &str) -> AppResult<()> {
        let path = format!("/api/v1/hosts/{}", urlencoding_path(id));
        let _: Option<Value> = self
            .send_opt(reqwest::Method::DELETE, &path, None::<&Value>)
            .await?;
        Ok(())
    }

    pub async fn set_proxy(&self, id: &str, enabled: bool) -> AppResult<CloudApiHost> {
        let path = format!("/api/v1/hosts/{}/proxy", urlencoding_path(id));
        #[derive(Serialize)]
        struct Body {
            is_proxy_enabled: bool,
        }
        self.send(reqwest::Method::PATCH, &path, Some(&Body { is_proxy_enabled: enabled }))
            .await
    }

    pub async fn reorder_hosts(&self, host_ids: &[String]) -> AppResult<Vec<CloudApiHost>> {
        #[derive(Serialize)]
        struct Body<'a> {
            host_ids: &'a [String],
        }
        self.send(
            reqwest::Method::PATCH,
            "/api/v1/hosts/reorder",
            Some(&Body { host_ids }),
        )
        .await
    }

    pub async fn list_tags(&self) -> AppResult<Vec<Tag>> {
        self.get("/api/v1/tags").await
    }

    pub async fn create_tag(&self, name: &str) -> AppResult<Tag> {
        #[derive(Serialize)]
        struct Body<'a> {
            name: &'a str,
            color: &'a str,
        }
        self.send(
            reqwest::Method::POST,
            "/api/v1/tags",
            Some(&Body {
                name: name.trim(),
                color: "#00FF00",
            }),
        )
        .await
    }

    pub async fn set_host_tags(&self, host_id: &str, tag_ids: &[String]) -> AppResult<CloudApiHost> {
        let path = format!("/api/v1/hosts/{}/tags", urlencoding_path(host_id));
        #[derive(Serialize)]
        struct Body<'a> {
            tag_ids: &'a [String],
        }
        self.send(reqwest::Method::PUT, &path, Some(&Body { tag_ids }))
            .await
    }

    pub async fn ensure_tag_ids(&self, names: &[String]) -> AppResult<Vec<String>> {
        let mut tags = self.list_tags().await?;
        let mut by_name: std::collections::HashMap<String, String> =
            tags.iter().map(|t| (t.name.clone(), t.id.clone())).collect();
        let mut ids = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for raw in names {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            if let Some(id) = by_name.get(name) {
                if seen.insert(id.clone()) {
                    ids.push(id.clone());
                }
                continue;
            }
            match self.create_tag(name).await {
                Ok(created) => {
                    by_name.insert(name.to_string(), created.id.clone());
                    if seen.insert(created.id.clone()) {
                        ids.push(created.id);
                    }
                }
                Err(e) => {
                    if e.to_string().contains("409") {
                        tags = self.list_tags().await?;
                        by_name = tags.iter().map(|t| (t.name.clone(), t.id.clone())).collect();
                        if let Some(id) = by_name.get(name) {
                            if seen.insert(id.clone()) {
                                ids.push(id.clone());
                            }
                            continue;
                        }
                    }
                    return Err(e);
                }
            }
        }
        Ok(ids)
    }

    pub async fn sync_host_tags_by_names(
        &self,
        host_id: &str,
        names: &[String],
    ) -> AppResult<CloudApiHost> {
        let ids = self.ensure_tag_ids(names).await?;
        self.set_host_tags(host_id, &ids).await
    }

    pub async fn get_telemetry(&self, host_id: &str) -> AppResult<Telemetry> {
        let path = format!("/api/v1/hosts/{}/telemetry", urlencoding_path(host_id));
        let raw: RawTel = self.get(&path).await?;
        Ok(raw.into_telemetry(host_id))
    }

    pub async fn get_telemetry_history(&self, host_id: &str) -> AppResult<Vec<Telemetry>> {
        let path = format!(
            "/api/v1/hosts/{}/telemetry/history",
            urlencoding_path(host_id)
        );
        let raw: Vec<RawTel> = match self.get(&path).await {
            Ok(v) => v,
            Err(e) => {
                if e.to_string().contains("404") || e.to_string().contains("not found") {
                    return Ok(Vec::new());
                }
                return Err(e);
            }
        };
        Ok(raw
            .into_iter()
            .map(|r| r.into_telemetry(host_id))
            .collect())
    }

    pub fn ws_proxy_url(&self, host_id: &str) -> AppResult<String> {
        if self.base_url.is_empty() || self.token.is_empty() {
            return Err(AppError::msg("core URL/token not configured"));
        }
        let mut u = url::Url::parse(&self.base_url)?;
        match u.scheme() {
            "https" => {
                let _ = u.set_scheme("wss");
            }
            "http" => {
                let _ = u.set_scheme("ws");
            }
            other => return Err(AppError::msg(format!("unsupported scheme {other}"))),
        }
        u.set_path(&format!("/ws/proxy/{host_id}"));
        u.set_query(None);
        u.query_pairs_mut().append_pair("token", &self.token);
        Ok(u.to_string())
    }

    pub(crate) async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> AppResult<T> {
        self.send(reqwest::Method::GET, path, None::<&Value>).await
    }

    pub(crate) async fn send<T, B>(&self, method: reqwest::Method, path: &str, body: Option<&B>) -> AppResult<T>
    where
        T: serde::de::DeserializeOwned,
        B: Serialize,
    {
        let v: Option<T> = self.send_opt(method, path, body).await?;
        v.ok_or_else(|| AppError::msg("empty core response"))
    }

    pub(crate) async fn send_opt<T, B>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&B>,
    ) -> AppResult<Option<T>>
    where
        T: serde::de::DeserializeOwned,
        B: Serialize,
    {
        if self.base_url.is_empty() {
            return Err(AppError::msg("core URL not configured"));
        }
        let url = format!("{}{path}", self.base_url);
        let mut req = self.http.request(method.clone(), &url);
        if let Some(b) = body {
            let raw = serde_json::to_vec(b)?;
            assert_no_host_secrets(path, &raw)?;
            req = req.header("Content-Type", "application/json").body(raw);
        }
        if !self.token.is_empty() {
            if self.token.starts_with("vxk_") {
                req = req.header("X-API-Key", &self.token);
            } else {
                req = req.header("Authorization", format!("Bearer {}", self.token));
            }
        }
        let res = req.send().await?;
        let status = res.status();
        let bytes = res.bytes().await?;
        if !status.is_success() {
            return Err(map_core_error(status, &bytes, path, &self.web_url));
        }
        if bytes.is_empty() {
            return Ok(None);
        }
        let parsed = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::msg(format!("decode core response: {e}")))?;
        Ok(Some(parsed))
    }
}

pub fn valid_session_token(token: &str) -> bool {
    crate::db::models::looks_like_session_token(token)
}

pub fn ip_address_ptr(addr: &str) -> Option<String> {
    let addr = addr.trim();
    if addr.is_empty() {
        return None;
    }
    addr.parse::<std::net::IpAddr>().ok().map(|_| addr.to_string())
}

pub fn assert_no_host_secrets(path: &str, raw: &[u8]) -> AppResult<()> {
    let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(raw) else {
        return Ok(());
    };
    for k in FORBIDDEN_ALWAYS {
        if map.contains_key(*k) {
            return Err(AppError::msg(format!(
                "zero-trust: refusing to send field {k:?} to core"
            )));
        }
    }
    if path.contains("/hosts") {
        for k in FORBIDDEN_ON_HOSTS {
            if map.contains_key(*k) {
                return Err(AppError::msg(format!(
                    "zero-trust: refusing to send field {k:?} to core"
                )));
            }
        }
    }
    Ok(())
}

fn map_core_error(status: reqwest::StatusCode, body: &[u8], path: &str, web_url: &str) -> AppError {
    let text = String::from_utf8_lossy(body);
    let (code, message) = parse_detail(&text);
    if code == "2fa_required"
        || code == "totp_required"
        || message.contains("2fa")
        || message.contains("2FA")
        || message.contains("TOTP")
    {
        let msg = if message.is_empty() {
            "2FA is required for this Core action. Enable TOTP in the Vortex Web cabinet."
                .to_string()
        } else {
            message
        };
        return AppError::two_fa(msg, web_url);
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return AppError::core(
            "unauthorized",
            "unauthorized — sign in again from Settings → Log in",
        );
    }
    let msg = if message.is_empty() {
        truncate(&text, 200)
    } else {
        message
    };
    AppError::msg(format!("core {status} {path}: {msg}"))
}

fn parse_detail(text: &str) -> (String, String) {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return (String::new(), String::new());
    };
    let detail = v.get("detail").cloned().unwrap_or(Value::Null);
    match detail {
        Value::Object(o) => (
            o.get("code")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string(),
            o.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string(),
        ),
        Value::String(s) => (String::new(), s),
        _ => (String::new(), String::new()),
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        format!("{}…", &s[..n])
    }
}

fn urlencoding_path(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct Tag {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct AgentStatus {
    pub id: String,
    #[serde(default)]
    pub is_online: bool,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RawTel {
    #[serde(default)]
    host_id: String,
    cpu_percent: Option<f64>,
    ram_percent: Option<f64>,
    ram_used_bytes: Option<i64>,
    ram_total_bytes: Option<i64>,
    net_bytes_sent: Option<i64>,
    net_bytes_recv: Option<i64>,
    uptime_seconds: Option<i64>,
    #[serde(default)]
    collected_at: Option<String>,
}

impl RawTel {
    fn into_telemetry(self, fallback_id: &str) -> Telemetry {
        Telemetry {
            host_id: if self.host_id.is_empty() {
                fallback_id.to_string()
            } else {
                self.host_id
            },
            cpu_percent: self.cpu_percent,
            ram_percent: self.ram_percent,
            ram_used_bytes: self.ram_used_bytes,
            ram_total_bytes: self.ram_total_bytes,
            net_bytes_sent: self.net_bytes_sent,
            net_bytes_recv: self.net_bytes_recv,
            uptime_seconds: self.uptime_seconds,
            collected_at: self.collected_at.unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CloudApiHost {
    pub id: String,
    pub name: String,
    pub ip_address: Option<String>,
    #[serde(default)]
    pub port: i64,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub is_proxy_enabled: bool,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub tags: Vec<Tag>,
    pub agent: Option<AgentStatus>,
    #[serde(default)]
    pub billing_enabled: bool,
    pub billing_cycle: Option<String>,
    pub billing_custom_days: Option<i64>,
    pub billing_renewal_at: Option<String>,
    pub billing_amount: Option<serde_json::Value>,
    pub billing_currency: Option<String>,
    #[serde(default)]
    pub billing_auto_renew: bool,
    pub billing_notes: Option<String>,
    pub billing_payer_id: Option<String>,
    pub payer: Option<PayerBrief>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct PayerBrief {
    pub id: String,
    pub name: String,
}

impl CloudApiHost {
    pub fn to_cloud_host(&self) -> CloudHost {
        CloudHost {
            id: self.id.clone(),
            name: self.name.clone(),
            address: self.ip_address.clone().unwrap_or_default(),
            port: if self.port == 0 { 22 } else { self.port },
            username: self.username.clone(),
            proxy_enabled: self.is_proxy_enabled,
            tags: self.tags.iter().map(|t| t.name.clone()).collect(),
            agent_online: self.agent.as_ref().map(|a| a.is_online).unwrap_or(false),
            agent_id: self.agent.as_ref().map(|a| a.id.clone()).unwrap_or_default(),
            sort_order: self.sort_order,
            billing: HostBilling {
                enabled: self.billing_enabled,
                cycle: self.billing_cycle.clone(),
                custom_days: self.billing_custom_days,
                renewal_at: self.billing_renewal_at.clone(),
                amount: json_to_opt_string(self.billing_amount.clone()),
                currency: self.billing_currency.clone(),
                auto_renew: self.billing_auto_renew,
                notes: self.billing_notes.clone(),
                payer_id: self.billing_payer_id.clone(),
                payer_name: self.payer.as_ref().map(|p| p.name.clone()),
            },
        }
    }
}

fn json_to_opt_string(v: Option<Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Some(s),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HostWrite {
    pub name: String,
    pub ip_address: Option<String>,
    pub port: i64,
    pub username: String,
    pub is_proxy_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_custom_days: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_renewal_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_auto_renew: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_payer_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub ip_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_custom_days: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_renewal_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_auto_renew: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_payer_id: Option<Option<String>>,
}

fn apply_billing_to_write(w: &mut HostWrite, b: &HostBilling) {
    w.billing_enabled = Some(b.enabled);
    if b.enabled {
        w.billing_cycle = b.cycle.clone();
        w.billing_custom_days = b.custom_days;
        w.billing_renewal_at = b.renewal_at.clone();
        w.billing_amount = b.amount.clone();
        w.billing_currency = b.currency.clone();
        w.billing_auto_renew = Some(b.auto_renew);
        w.billing_notes = b.notes.clone();
        w.billing_payer_id = Some(b.payer_id.clone());
    } else {
        w.billing_payer_id = Some(None);
    }
}

fn apply_billing_to_patch(p: &mut HostPatch, b: &HostBilling) {
    p.billing_enabled = Some(b.enabled);
    if b.enabled {
        p.billing_cycle = b.cycle.clone();
        p.billing_custom_days = b.custom_days;
        p.billing_renewal_at = b.renewal_at.clone();
        p.billing_amount = b.amount.clone();
        p.billing_currency = b.currency.clone();
        p.billing_auto_renew = Some(b.auto_renew);
        p.billing_notes = b.notes.clone();
        p.billing_payer_id = Some(b.payer_id.clone());
    } else {
        p.billing_payer_id = Some(None);
    }
}

impl HostWrite {
    pub fn with_billing(mut self, billing: Option<&HostBilling>) -> Self {
        if let Some(b) = billing {
            apply_billing_to_write(&mut self, b);
        }
        self
    }
}

impl HostPatch {
    pub fn with_billing(mut self, billing: Option<&HostBilling>) -> Self {
        if let Some(b) = billing {
            apply_billing_to_patch(&mut self, b);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_host_password() {
        let raw = serde_json::to_vec(&serde_json::json!({
            "name": "x",
            "password": "nope"
        }))
        .unwrap();
        let err = assert_no_host_secrets("/api/v1/hosts", &raw).unwrap_err();
        assert!(err.to_string().contains("zero-trust"));
    }

    #[test]
    fn allows_login_password() {
        let raw = serde_json::to_vec(&serde_json::json!({
            "email": "a@b.c",
            "password": "account-only"
        }))
        .unwrap();
        assert!(assert_no_host_secrets("/api/v1/auth/login", &raw).is_ok());
    }

    #[test]
    fn rejects_private_key_everywhere() {
        let raw = serde_json::to_vec(&serde_json::json!({ "private_key": "-----BEGIN" })).unwrap();
        assert!(assert_no_host_secrets("/api/v1/auth/login", &raw).is_err());
    }

    #[test]
    fn ws_proxy_url_prod() {
        let c = Client::new("https://api.vortex.timant32.ru", "vxk_abcdefghijklmnopqrstuvwxyz");
        let u = c.ws_proxy_url("host-1").unwrap();
        assert!(u.starts_with("wss://api.vortex.timant32.ru/ws/proxy/host-1?"));
        assert!(u.contains("token="));
    }

    #[test]
    fn ws_proxy_url_local() {
        let c = Client::new("http://127.0.0.1:8000", "vxk_abcdefghijklmnopqrstuvwxyz");
        let u = c.ws_proxy_url("abc").unwrap();
        assert!(u.starts_with("ws://127.0.0.1:8000/ws/proxy/abc?"));
    }
}
