use chrono::Utc;
use uuid::Uuid;

use crate::db::models::{AuthType, CloudHost, ExportBundle, Host, Secret, Source};
use crate::db::store::Store;
use crate::error::AppResult;

/// Upsert cloud metadata by host UUID.
/// Local secrets are never touched. Purely-local hosts are left intact.
/// Cloud-sourced hosts missing from the remote roster are deleted locally
/// (including their local secrets via CASCADE).
pub fn merge_cloud(store: &Store, cloud: &[CloudHost]) -> AppResult<(i64, i64)> {
    let now = Utc::now();
    let mut remote_ids = std::collections::HashSet::new();
    let mut upserted = 0i64;

    for (i, c) in cloud.iter().enumerate() {
        if c.id.is_empty() {
            continue;
        }
        remote_ids.insert(c.id.clone());
        let existing = store.get_host(&c.id).ok();
        let mut h = Host {
            id: c.id.clone(),
            name: c.name.clone(),
            address: c.address.clone(),
            port: if c.port == 0 { 22 } else { c.port },
            user: c.username.clone(),
            tags: c.tags.clone(),
            source: Source::Cloud,
            proxy_enabled: c.proxy_enabled,
            agent_online: c.agent_online,
            agent_id: c.agent_id.clone(),
            has_secret: existing.as_ref().map(|e| e.has_secret).unwrap_or(false),
            auth_type: existing.as_ref().and_then(|e| e.auth_type),
            sort_order: i as i64,
            created_at: existing
                .as_ref()
                .map(|e| e.created_at)
                .unwrap_or(now),
            updated_at: now,
            last_synced_at: Some(now),
            billing: c.billing.clone(),
        };
        if let Some(e) = existing {
            h.created_at = e.created_at;
        }
        store.upsert_host(h)?;
        upserted += 1;
    }

    let mut removed = 0i64;
    for h in store.list_hosts()? {
        if !matches!(h.source, Source::Cloud) {
            continue;
        }
        if remote_ids.contains(&h.id) {
            continue;
        }
        store.delete_host(&h.id)?;
        removed += 1;
    }

    store.set_setting(
        "last_sync_at",
        &now.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true),
    )?;
    Ok((upserted, removed))
}

/// Merge an export into the local DB. overwrite_secrets replaces existing secrets.
pub fn import_bundle(store: &Store, b: ExportBundle, overwrite_secrets: bool) -> AppResult<i64> {
    let mut n = 0i64;
    for eh in b.hosts {
        let id = if eh.id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            eh.id.clone()
        };
        let src = Source::parse(&eh.source);
        let existing = store.get_host(&id).ok();
        let mut h = Host {
            id: id.clone(),
            name: eh.name,
            address: eh.address,
            port: if eh.port == 0 { 22 } else { eh.port },
            user: eh.user,
            tags: eh.tags,
            source: src,
            proxy_enabled: eh.proxy_enabled,
            agent_online: existing.as_ref().map(|e| e.agent_online).unwrap_or(false),
            agent_id: existing
                .as_ref()
                .map(|e| e.agent_id.clone())
                .unwrap_or_default(),
            has_secret: false,
            auth_type: None,
            sort_order: 0,
            created_at: existing.as_ref().map(|e| e.created_at).unwrap_or_else(Utc::now),
            updated_at: Utc::now(),
            last_synced_at: None,
            billing: existing
                .as_ref()
                .map(|e| e.billing.clone())
                .unwrap_or_default(),
        };
        if let Some(e) = &existing {
            h.created_at = e.created_at;
            h.agent_online = e.agent_online;
            h.agent_id = e.agent_id.clone();
        }
        store.upsert_host(h)?;
        n += 1;
    }
    for es in b.secrets {
        if es.host_id.is_empty() || es.payload.is_empty() {
            continue;
        }
        if !overwrite_secrets && store.get_secret(&es.host_id)?.is_some() {
            continue;
        }
        let t = AuthType::parse(&es.auth_type).unwrap_or(AuthType::Password);
        store.set_secret(&Secret {
            host_id: es.host_id,
            auth_type: t,
            payload: es.payload,
        })?;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::random_key;
    use crate::db::store::Store;

    fn mem() -> Store {
        Store::open(
            std::path::Path::new(":memory:"),
            random_key().unwrap().to_vec(),
        )
        .unwrap()
    }

    #[test]
    fn merge_keeps_local_secret_and_local_only_hosts() {
        let s = mem();
        let local_id = Uuid::new_v4().to_string();
        s.upsert_host(Host {
            id: local_id.clone(),
            name: "only-local".into(),
            address: "192.168.1.8".into(),
            port: 22,
            user: "root".into(),
            tags: vec![],
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
            billing: crate::db::HostBilling::default(),
        })
        .unwrap();
        s.set_secret(&Secret {
            host_id: local_id.clone(),
            auth_type: AuthType::Password,
            payload: "stay-local".into(),
        })
        .unwrap();

        let cloud_id = Uuid::new_v4().to_string();
        s.upsert_host(Host {
            id: cloud_id.clone(),
            name: "old-name".into(),
            address: "1.1.1.1".into(),
            port: 22,
            user: "ubuntu".into(),
            tags: vec![],
            source: Source::Cloud,
            proxy_enabled: false,
            agent_online: false,
            agent_id: String::new(),
            has_secret: false,
            auth_type: None,
            sort_order: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_synced_at: None,
            billing: crate::db::HostBilling::default(),
        })
        .unwrap();
        s.set_secret(&Secret {
            host_id: cloud_id.clone(),
            auth_type: AuthType::Password,
            payload: "cloud-host-secret".into(),
        })
        .unwrap();

        let (up, rem) = merge_cloud(
            &s,
            &[CloudHost {
                id: cloud_id.clone(),
                name: "new-name".into(),
                address: "8.8.8.8".into(),
                port: 2222,
                username: "ubuntu".into(),
                proxy_enabled: true,
                tags: vec!["prod".into()],
                agent_online: true,
                agent_id: "ag-1".into(),
                sort_order: 0,
                billing: crate::db::HostBilling::default(),
            }],
        )
        .unwrap();
        assert_eq!(up, 1);
        assert_eq!(rem, 0);

        let cloud = s.get_host(&cloud_id).unwrap();
        assert_eq!(cloud.name, "new-name");
        assert!(cloud.proxy_enabled);
        assert!(cloud.agent_online);
        assert_eq!(
            s.get_secret(&cloud_id).unwrap().unwrap().payload,
            "cloud-host-secret"
        );

        let local = s.get_host(&local_id).unwrap();
        assert_eq!(local.source, Source::Local);
        assert_eq!(
            s.get_secret(&local_id).unwrap().unwrap().payload,
            "stay-local"
        );
    }

    #[test]
    fn merge_removes_cloud_hosts_deleted_remotely() {
        let s = mem();
        let gone = Uuid::new_v4().to_string();
        s.upsert_host(Host {
            id: gone.clone(),
            name: "gone".into(),
            address: String::new(),
            port: 22,
            user: "root".into(),
            tags: vec![],
            source: Source::Cloud,
            proxy_enabled: true,
            agent_online: false,
            agent_id: String::new(),
            has_secret: false,
            auth_type: None,
            sort_order: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_synced_at: None,
            billing: crate::db::HostBilling::default(),
        })
        .unwrap();
        let (up, rem) = merge_cloud(&s, &[]).unwrap();
        assert_eq!(up, 0);
        assert_eq!(rem, 1);
        assert!(s.get_host(&gone).is_err());
    }
}
