use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::crypto;
use crate::db::models::{
    looks_like_session_token, AuthType, ExportBundle, ExportHost, ExportSecret, Host, Secret,
    Settings, Source,
};
use crate::error::{AppError, AppResult};

pub struct Store {
    db: Connection,
    master_key: Vec<u8>,
}

impl Store {
    pub fn open(path: &std::path::Path, master_key: Vec<u8>) -> AppResult<Self> {
        if master_key.len() != 32 {
            return Err(AppError::msg("master key must be 32 bytes"));
        }
        let db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let s = Self { db, master_key };
        s.migrate()?;
        Ok(s)
    }

    fn migrate(&self) -> AppResult<()> {
        self.db.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'local',
  proxy_enabled INTEGER NOT NULL DEFAULT 0,
  agent_online INTEGER NOT NULL DEFAULT 0,
  agent_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS local_secrets (
  host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL,
  ciphertext BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#,
        )?;
        let _ = self
            .db
            .execute("ALTER TABLE hosts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0", []);
        let _ = self
            .db
            .execute("ALTER TABLE hosts ADD COLUMN billing_json TEXT NOT NULL DEFAULT '{}'", []);
        Ok(())
    }

    pub fn list_hosts(&self) -> AppResult<Vec<Host>> {
        let mut stmt = self.db.prepare(
            r#"
SELECT h.id, h.name, h.address, h.port, h.username, h.tags_json, h.source, h.proxy_enabled,
       h.agent_online, h.agent_id, h.created_at, h.updated_at, h.last_synced_at, h.sort_order,
       EXISTS(SELECT 1 FROM local_secrets ls WHERE ls.host_id = h.id),
       (SELECT ls.auth_type FROM local_secrets ls WHERE ls.host_id = h.id),
       h.billing_json
FROM hosts h ORDER BY h.sort_order ASC, h.name COLLATE NOCASE
"#,
        )?;
        let rows = stmt.query_map([], scan_host)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_host(&self, id: &str) -> AppResult<Host> {
        let mut stmt = self.db.prepare(
            r#"
SELECT h.id, h.name, h.address, h.port, h.username, h.tags_json, h.source, h.proxy_enabled,
       h.agent_online, h.agent_id, h.created_at, h.updated_at, h.last_synced_at, h.sort_order,
       EXISTS(SELECT 1 FROM local_secrets ls WHERE ls.host_id = h.id),
       (SELECT ls.auth_type FROM local_secrets ls WHERE ls.host_id = h.id),
       h.billing_json
FROM hosts h WHERE h.id = ?1
"#,
        )?;
        stmt.query_row(params![id], scan_host)
            .map_err(|_| AppError::msg("host not found"))
    }

    fn next_sort_order(&self) -> AppResult<i64> {
        let n: Option<i64> = self
            .db
            .query_row("SELECT MAX(sort_order) FROM hosts", [], |r| r.get(0))?;
        Ok(n.unwrap_or(-1) + 1)
    }

    pub fn upsert_host(&self, mut h: Host) -> AppResult<()> {
        let now = Utc::now();
        if h.created_at.timestamp() == 0 {
            h.created_at = now;
        }
        h.updated_at = now;
        let tags = serde_json::to_string(&h.tags)?;
        let synced = h
            .last_synced_at
            .map(|t| t.to_rfc3339_opts(SecondsFormat::Nanos, true));

        let existing: Option<i64> = self
            .db
            .query_row(
                "SELECT sort_order FROM hosts WHERE id = ?1",
                params![h.id],
                |r| r.get(0),
            )
            .optional()?;

        match existing {
            None => {
                if !matches!(h.source, Source::Cloud) {
                    h.sort_order = self.next_sort_order()?;
                }
            }
            Some(cur) => {
                if !matches!(h.source, Source::Cloud) {
                    h.sort_order = cur;
                }
            }
        }

        self.db.execute(
            r#"
INSERT INTO hosts (id, name, address, port, username, tags_json, source, proxy_enabled,
                   agent_online, agent_id, sort_order, created_at, updated_at, last_synced_at,
                   billing_json)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  address=excluded.address,
  port=excluded.port,
  username=excluded.username,
  tags_json=excluded.tags_json,
  source=excluded.source,
  proxy_enabled=excluded.proxy_enabled,
  agent_online=excluded.agent_online,
  agent_id=excluded.agent_id,
  sort_order=excluded.sort_order,
  updated_at=excluded.updated_at,
  last_synced_at=COALESCE(excluded.last_synced_at, hosts.last_synced_at),
  billing_json=excluded.billing_json
"#,
            params![
                h.id,
                h.name,
                h.address,
                h.port,
                h.user,
                tags,
                h.source.as_str(),
                h.proxy_enabled as i64,
                h.agent_online as i64,
                h.agent_id,
                h.sort_order,
                h.created_at.to_rfc3339_opts(SecondsFormat::Nanos, true),
                h.updated_at.to_rfc3339_opts(SecondsFormat::Nanos, true),
                synced,
                serde_json::to_string(&h.billing).unwrap_or_else(|_| "{}".into()),
            ],
        )?;
        Ok(())
    }

    pub fn reorder_hosts(&self, ordered_ids: &[String]) -> AppResult<()> {
        let tx = self.db.unchecked_transaction()?;
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
        for (i, id) in ordered_ids.iter().enumerate() {
            let n = tx.execute(
                "UPDATE hosts SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
                params![i as i64, now, id],
            )?;
            if n == 0 {
                return Err(AppError::msg("host not found"));
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn move_host(&self, id: &str, delta: i64) -> AppResult<()> {
        let hosts = self.list_hosts()?;
        let idx = hosts
            .iter()
            .position(|h| h.id == id)
            .ok_or_else(|| AppError::msg("host not found"))?;
        let j = idx as i64 + delta;
        if j < 0 || j >= hosts.len() as i64 {
            return Ok(());
        }
        let mut ids: Vec<String> = hosts.into_iter().map(|h| h.id).collect();
        ids.swap(idx, j as usize);
        self.reorder_hosts(&ids)
    }

    pub fn delete_host(&self, id: &str) -> AppResult<()> {
        let n = self.db.execute("DELETE FROM hosts WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(AppError::msg("host not found"));
        }
        Ok(())
    }

    pub fn set_secret(&self, sec: &Secret) -> AppResult<()> {
        if sec.host_id.is_empty() || sec.payload.is_empty() {
            return Err(AppError::msg("invalid secret"));
        }
        let ct = crypto::encrypt_at_rest(&self.master_key, sec.payload.as_bytes())
            .map_err(|e| AppError::msg(e.to_string()))?;
        self.db.execute(
            r#"
INSERT INTO local_secrets (host_id, auth_type, ciphertext) VALUES (?1, ?2, ?3)
ON CONFLICT(host_id) DO UPDATE SET auth_type=excluded.auth_type, ciphertext=excluded.ciphertext
"#,
            params![sec.host_id, sec.auth_type.as_str(), ct],
        )?;
        Ok(())
    }

    pub fn get_secret(&self, host_id: &str) -> AppResult<Option<Secret>> {
        let row: Option<(String, Vec<u8>)> = self
            .db
            .query_row(
                "SELECT auth_type, ciphertext FROM local_secrets WHERE host_id = ?1",
                params![host_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((auth_type, ct)) = row else {
            return Ok(None);
        };
        let plain = crypto::decrypt_at_rest(&self.master_key, &ct)
            .map_err(|e| AppError::msg(e.to_string()))?;
        let payload = String::from_utf8(plain).map_err(|_| AppError::msg("secret is not utf-8"))?;
        let auth_type =
            AuthType::parse(&auth_type).ok_or_else(|| AppError::msg("invalid auth type"))?;
        Ok(Some(Secret {
            host_id: host_id.to_string(),
            auth_type,
            payload,
        }))
    }

    #[allow(dead_code)]
    pub fn delete_secret(&self, host_id: &str) -> AppResult<()> {
        self.db
            .execute("DELETE FROM local_secrets WHERE host_id = ?1", params![host_id])?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let v = self
            .db
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        self.db.execute(
            r#"
INSERT INTO settings (key, value) VALUES (?1, ?2)
ON CONFLICT(key) DO UPDATE SET value=excluded.value
"#,
            params![key, value],
        )?;
        Ok(())
    }

    pub fn load_settings(&self) -> AppResult<Settings> {
        let mut st = Settings::default();
        if let Some(v) = self.get_setting("core_url")? {
            st.core_url = v;
        }
        if let Some(v) = self.get_setting("web_url")? {
            st.web_url = v;
        }
        if let Some(v) = self.get_setting("api_key")? {
            st.api_key = v;
        }
        if let Some(v) = self.get_setting("account_email")? {
            st.account_email = v;
        }
        st.sync_on_start = true;
        if let Some(v) = self.get_setting("sync_on_start")? {
            st.sync_on_start = v == "1" || v.eq_ignore_ascii_case("true");
        }
        st.terminal_layout = "tabs".into();
        if let Some(v) = self.get_setting("terminal_layout")? {
            st.terminal_layout = crate::db::models::normalize_terminal_layout(&v);
        }
        st.ssh_command = "kitty +kitten ssh".into();
        if let Some(v) = self.get_setting("ssh_command")? {
            let t = v.trim();
            if !t.is_empty() {
                st.ssh_command = t.to_string();
            }
        }
        st.system_terminal = crate::config::infer_system_terminal(&st.ssh_command);
        if let Some(v) = self.get_setting("system_terminal")? {
            let t = v.trim();
            if !t.is_empty() {
                st.system_terminal = crate::config::normalize_system_terminal(t);
            }
        }
        if let Some(v) = self.get_setting("last_sync_at")? {
            if !v.is_empty() {
                if let Ok(t) = DateTime::parse_from_rfc3339(&v) {
                    st.last_sync_at = Some(t.with_timezone(&Utc));
                }
            }
        }
        if !st.api_key.is_empty() && !looks_like_session_token(&st.api_key) {
            self.clear_session()?;
            st.api_key.clear();
            st.account_email.clear();
        }
        Ok(st)
    }

    pub fn save_settings(&self, st: &Settings) -> AppResult<()> {
        self.set_setting("core_url", &st.core_url)?;
        self.set_setting("web_url", &st.web_url)?;
        self.set_setting("api_key", &st.api_key)?;
        self.set_setting("account_email", &st.account_email)?;
        self.set_setting("sync_on_start", if st.sync_on_start { "1" } else { "0" })?;
        self.set_setting(
            "terminal_layout",
            &crate::db::models::normalize_terminal_layout(&st.terminal_layout),
        )?;
        let system_terminal = crate::config::normalize_system_terminal(&st.system_terminal);
        let ssh_command =
            crate::config::resolve_ssh_command(&system_terminal, &st.ssh_command);
        self.set_setting("system_terminal", &system_terminal)?;
        self.set_setting("ssh_command", &ssh_command)?;
        if let Some(t) = st.last_sync_at {
            self.set_setting(
                "last_sync_at",
                &t.to_rfc3339_opts(SecondsFormat::Nanos, true),
            )?;
        }
        Ok(())
    }

    pub fn clear_session(&self) -> AppResult<()> {
        self.set_setting("api_key", "")?;
        self.set_setting("account_email", "")?;
        Ok(())
    }

    pub fn export_bundle(&self) -> AppResult<ExportBundle> {
        let hosts = self.list_hosts()?;
        let mut b = ExportBundle {
            version: 1,
            hosts: Vec::new(),
            secrets: Vec::new(),
        };
        for h in hosts {
            b.hosts.push(ExportHost {
                id: h.id.clone(),
                name: h.name,
                address: h.address,
                port: h.port,
                user: h.user,
                tags: h.tags,
                source: h.source.as_str().to_string(),
                proxy_enabled: h.proxy_enabled,
            });
            if let Some(sec) = self.get_secret(&h.id)? {
                b.secrets.push(ExportSecret {
                    host_id: sec.host_id,
                    auth_type: sec.auth_type.as_str().to_string(),
                    payload: sec.payload,
                });
            }
        }
        Ok(b)
    }
}

fn scan_host(row: &rusqlite::Row<'_>) -> rusqlite::Result<Host> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let source: String = row.get(6)?;
    let proxy: i64 = row.get(7)?;
    let agent: i64 = row.get(8)?;
    let created: String = row.get(10)?;
    let updated: String = row.get(11)?;
    let synced: Option<String> = row.get(12)?;
    let has_secret: i64 = row.get(14)?;
    let auth_type: Option<String> = row.get(15)?;
    let billing_json: String = row.get(16).unwrap_or_else(|_| "{}".into());
    Ok(Host {
        id: row.get(0)?,
        name: row.get(1)?,
        address: row.get(2)?,
        port: row.get(3)?,
        user: row.get(4)?,
        tags,
        source: Source::parse(&source),
        proxy_enabled: proxy == 1,
        agent_online: agent == 1,
        agent_id: row.get(9)?,
        has_secret: has_secret == 1,
        auth_type: auth_type.as_deref().and_then(AuthType::parse),
        sort_order: row.get(13)?,
        created_at: parse_ts(&created),
        updated_at: parse_ts(&updated),
        last_synced_at: synced.filter(|s| !s.is_empty()).map(|s| parse_ts(&s)),
        billing: serde_json::from_str(&billing_json).unwrap_or_default(),
    })
}

fn parse_ts(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|t| t.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

pub fn new_local_host_id() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::random_key;

    fn mem_store() -> Store {
        let key = random_key().unwrap().to_vec();
        Store::open(std::path::Path::new(":memory:"), key).unwrap()
    }

    #[test]
    fn secret_roundtrip_never_in_host_row() {
        let s = mem_store();
        let id = new_local_host_id();
        let h = Host {
            id: id.clone(),
            name: "lab".into(),
            address: "10.0.0.1".into(),
            port: 22,
            user: "root".into(),
            tags: vec!["prod".into()],
            source: Source::Local,
            proxy_enabled: false,
            agent_online: false,
            agent_id: String::new(),
            has_secret: false,
            auth_type: None,
            sort_order: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_synced_at: None,
            billing: Default::default(),
        };
        s.upsert_host(h).unwrap();
        s.set_secret(&Secret {
            host_id: id.clone(),
            auth_type: AuthType::Password,
            payload: "hunter2-not-logged".into(),
        })
        .unwrap();
        let listed = s.get_host(&id).unwrap();
        assert!(listed.has_secret);
        assert_eq!(listed.auth_type, Some(AuthType::Password));
        let sec = s.get_secret(&id).unwrap().unwrap();
        assert_eq!(sec.payload, "hunter2-not-logged");
    }
}
