use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Local,
    Cloud,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Cloud => "cloud",
        }
    }

    pub fn parse(s: &str) -> Self {
        if s == "cloud" {
            Self::Cloud
        } else {
            Self::Local
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Password,
    PrivateKey,
}

impl AuthType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::PrivateKey => "private_key",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "password" => Some(Self::Password),
            "private_key" => Some(Self::PrivateKey),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: i64,
    pub user: String,
    pub tags: Vec<String>,
    pub source: Source,
    pub proxy_enabled: bool,
    pub agent_online: bool,
    pub agent_id: String,
    pub has_secret: bool,
    pub auth_type: Option<AuthType>,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_synced_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub billing: HostBilling,
}

/// Cloud billing metadata. Never contains SSH secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostBilling {
    #[serde(default)]
    pub enabled: bool,
    pub cycle: Option<String>,
    pub custom_days: Option<i64>,
    pub renewal_at: Option<String>,
    pub amount: Option<String>,
    pub currency: Option<String>,
    #[serde(default)]
    pub auto_renew: bool,
    pub notes: Option<String>,
    pub payer_id: Option<String>,
    pub payer_name: Option<String>,
}

impl Default for HostBilling {
    fn default() -> Self {
        Self {
            enabled: false,
            cycle: None,
            custom_days: None,
            renewal_at: None,
            amount: None,
            currency: None,
            auto_renew: true,
            notes: None,
            payer_id: None,
            payer_name: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Secret {
    pub host_id: String,
    pub auth_type: AuthType,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub core_url: String,
    pub web_url: String,
    pub api_key: String,
    pub account_email: String,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub sync_on_start: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            core_url: String::new(),
            web_url: String::new(),
            api_key: String::new(),
            account_email: String::new(),
            last_sync_at: None,
            sync_on_start: true,
        }
    }
}

/// Settings as returned to the UI — API key is never included.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPublic {
    pub core_url: String,
    pub web_url: String,
    pub account_email: String,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub sync_on_start: bool,
    pub linked: bool,
}

impl Settings {
    pub fn public(&self) -> SettingsPublic {
        SettingsPublic {
            core_url: self.core_url.clone(),
            web_url: self.web_url.clone(),
            account_email: self.account_email.clone(),
            last_sync_at: self.last_sync_at,
            sync_on_start: self.sync_on_start,
            linked: looks_like_session_token(&self.api_key),
        }
    }
}

pub fn looks_like_session_token(token: &str) -> bool {
    let token = token.trim();
    if token.starts_with("vxk_") && token.len() > 16 {
        return true;
    }
    let parts: Vec<&str> = token.split('.').collect();
    parts.len() == 3 && parts[0].len() > 10 && parts[1].len() > 10
}

#[derive(Debug, Clone)]
pub struct CloudHost {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: i64,
    pub username: String,
    pub proxy_enabled: bool,
    pub tags: Vec<String>,
    pub agent_online: bool,
    pub agent_id: String,
    #[allow(dead_code)]
    pub sort_order: i64,
    pub billing: HostBilling,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportBundle {
    pub version: i32,
    pub hosts: Vec<ExportHost>,
    pub secrets: Vec<ExportSecret>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportHost {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: i64,
    pub user: String,
    pub tags: Vec<String>,
    pub source: String,
    pub proxy_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSecret {
    pub host_id: String,
    pub auth_type: String,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHostInput {
    pub id: Option<String>,
    pub name: String,
    pub address: String,
    pub port: i64,
    pub user: String,
    pub tags: Vec<String>,
    pub proxy_enabled: bool,
    pub publish_cloud: bool,
    /// New/replacement secret. Omitted = leave existing secret unchanged.
    pub secret: Option<SaveSecretInput>,
    #[serde(default)]
    pub billing: Option<HostBilling>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSecretInput {
    pub auth_type: AuthType,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub upserted: i64,
    pub removed: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMe {
    pub id: String,
    pub email: String,
    pub is_2fa_enabled: bool,
    pub require_2fa: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Telemetry {
    pub host_id: String,
    pub cpu_percent: Option<f64>,
    pub ram_percent: Option<f64>,
    pub ram_used_bytes: Option<i64>,
    pub ram_total_bytes: Option<i64>,
    pub net_bytes_sent: Option<i64>,
    pub net_bytes_recv: Option<i64>,
    pub uptime_seconds: Option<i64>,
    pub collected_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub session_id: String,
    pub mode: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_token_vxk() {
        assert!(looks_like_session_token(
            "vxk_abcdefghijklmnopqrstuvwxyz012345"
        ));
        assert!(!looks_like_session_token("JWT_SECRET_KEY"));
        assert!(!looks_like_session_token("vxk_short"));
    }
}
