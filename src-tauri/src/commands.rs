use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use chrono::Utc;
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

use crate::api::{
    self, valid_session_token, BillingCalendarResponse, BillingPayer, BillingPayerDetail,
    BillingSummaryResponse, Client, HostPatch, HostWrite,
};
use crate::config;
use crate::crypto;
use crate::db::{
    self, Host, SaveHostInput, Secret, SettingsPublic, Source, SyncResult, Telemetry, UserMe,
};
use crate::error::{AppError, AppResult};
use crate::ssh;
use crate::AppState;

fn client_from_settings(st: &db::Settings) -> AppResult<Client> {
    if st.api_key.is_empty() || !valid_session_token(&st.api_key) {
        return Err(AppError::msg(
            "not signed in — local mode is fine; Log in from Settings to use cloud",
        ));
    }
    Ok(Client::new(
        config::effective_core_url(&st.core_url),
        st.api_key.clone(),
    )
    .with_web_url(config::effective_web_url(&st.web_url)))
}

fn public_settings(st: &db::Settings) -> SettingsPublic {
    let mut p = st.public();
    p.core_url = config::effective_core_url(&p.core_url);
    p.web_url = config::effective_web_url(&p.web_url);
    p
}

#[tauri::command]
pub fn list_hosts(state: State<'_, AppState>) -> AppResult<Vec<Host>> {
    state.store.lock().list_hosts()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<SettingsPublic> {
    let st = state.store.lock().load_settings()?;
    Ok(public_settings(&st))
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    core_url: String,
    web_url: String,
    sync_on_start: bool,
    terminal_layout: Option<String>,
    system_terminal: Option<String>,
    ssh_command: Option<String>,
) -> AppResult<SettingsPublic> {
    let store = state.store.lock();
    let mut st = store.load_settings()?;
    st.core_url = core_url.trim().trim_end_matches('/').to_string();
    st.web_url = web_url.trim().trim_end_matches('/').to_string();
    st.sync_on_start = sync_on_start;
    if let Some(layout) = terminal_layout {
        st.terminal_layout = crate::db::normalize_terminal_layout(&layout);
    }
    if let Some(term) = system_terminal {
        st.system_terminal = config::normalize_system_terminal(&term);
    }
    if let Some(cmd) = ssh_command {
        st.ssh_command = config::effective_ssh_command(&cmd);
    }
    // Keep ssh_command in sync with preset (custom keeps freeform).
    st.ssh_command = config::resolve_ssh_command(&st.system_terminal, &st.ssh_command);
    store.save_settings(&st)?;
    Ok(public_settings(&st))
}

/// Race getjson mirrors, apply Core/Web URLs, return updated settings + mirror meta.
/// Always applies (explicit Reset). Startup auto-refresh only touches stock defaults.
#[tauri::command]
pub async fn reset_cloud_urls(
    state: State<'_, AppState>,
) -> AppResult<crate::discover::DiscoveredUrls> {
    let discovered = crate::discover::discover_urls().await?;
    {
        let store = state.store.lock();
        let mut st = store.load_settings()?;
        st.core_url = discovered.core_url.clone();
        st.web_url = discovered.web_url.clone();
        store.save_settings(&st)?;
    }
    Ok(discovered)
}

/// Launch the configured system SSH command for a direct host (TUI parity).
#[tauri::command]
pub fn open_system_ssh(state: State<'_, AppState>, host_id: String) -> AppResult<()> {
    let store = state.store.lock();
    let host = store.get_host(&host_id)?;
    let secret = store.get_secret(&host_id)?;
    let st = store.load_settings()?;
    let cmd = config::resolve_ssh_command(&st.system_terminal, &st.ssh_command);
    drop(store);
    ssh::system::spawn_system_ssh(&cmd, &host, secret.as_ref())
}

#[tauri::command]
pub async fn health(state: State<'_, AppState>) -> AppResult<bool> {
    let st = state.store.lock().load_settings()?;
    let client = Client::new(config::effective_core_url(&st.core_url), st.api_key);
    client.health().await?;
    Ok(true)
}

#[tauri::command]
pub async fn get_me(state: State<'_, AppState>) -> AppResult<UserMe> {
    let st = state.store.lock().load_settings()?;
    let client = client_from_settings(&st)?;
    client.whoami().await
}

#[tauri::command]
pub async fn browser_login(state: State<'_, AppState>) -> AppResult<SettingsPublic> {
    let st = state.store.lock().load_settings()?;
    let web = config::effective_web_url(&st.web_url);
    let core = config::effective_core_url(&st.core_url);
    let res = api::browser_login(&web).await?;
    if !valid_session_token(&res.token) {
        return Err(AppError::msg(
            "browser returned invalid token (expected vxk_… API key)",
        ));
    }
    let client = Client::new(&core, &res.token).with_web_url(&web);
    let me = client.whoami().await?;
    let email = if me.email.is_empty() {
        res.email
    } else {
        me.email
    };
    let public = {
        let store = state.store.lock();
        let mut next = store.load_settings()?;
        next.web_url = web;
        next.core_url = core;
        next.api_key = res.token;
        next.account_email = email;
        store.save_settings(&next)?;
        public_settings(&next)
    };
    Ok(public)
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> AppResult<SettingsPublic> {
    let store = state.store.lock();
    store.clear_session()?;
    let st = store.load_settings()?;
    Ok(public_settings(&st))
}

#[tauri::command]
pub async fn sync_cloud(state: State<'_, AppState>) -> AppResult<SyncResult> {
    let st = state.store.lock().load_settings()?;
    let client = client_from_settings(&st)?;
    let hosts = client.list_hosts().await?;
    let cloud: Vec<_> = hosts.iter().map(|h| h.to_cloud_host()).collect();
    let (upserted, removed) = db::merge_cloud(&state.store.lock(), &cloud)?;
    Ok(SyncResult { upserted, removed })
}

#[tauri::command]
pub async fn save_host(state: State<'_, AppState>, input: SaveHostInput) -> AppResult<Host> {
    let st = state.store.lock().load_settings()?;
    let existing = input
        .id
        .as_deref()
        .and_then(|id| state.store.lock().get_host(id).ok());
    let was_cloud = existing
        .as_ref()
        .map(|h| h.source == Source::Cloud)
        .unwrap_or(false);
    let now = Utc::now();

    let mut h = Host {
        id: input.id.clone().unwrap_or_else(db::new_local_host_id),
        name: input.name.trim().to_string(),
        address: input.address.trim().to_string(),
        port: if input.port == 0 { 22 } else { input.port },
        user: if input.user.trim().is_empty() {
            "root".into()
        } else {
            input.user.trim().to_string()
        },
        tags: input
            .tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect(),
        source: if was_cloud {
            Source::Cloud
        } else {
            Source::Local
        },
        proxy_enabled: input.proxy_enabled,
        agent_online: existing.as_ref().map(|e| e.agent_online).unwrap_or(false),
        agent_id: existing
            .as_ref()
            .map(|e| e.agent_id.clone())
            .unwrap_or_default(),
        has_secret: existing.as_ref().map(|e| e.has_secret).unwrap_or(false),
        auth_type: existing.as_ref().and_then(|e| e.auth_type),
        sort_order: existing.as_ref().map(|e| e.sort_order).unwrap_or(0),
        created_at: existing.as_ref().map(|e| e.created_at).unwrap_or(now),
        updated_at: now,
        last_synced_at: existing.as_ref().and_then(|e| e.last_synced_at),
        billing: input
            .billing
            .clone()
            .or_else(|| existing.as_ref().map(|e| e.billing.clone()))
            .unwrap_or_default(),
    };
    if h.name.is_empty() {
        return Err(AppError::msg("name is required"));
    }

    if input.publish_cloud {
        let client = client_from_settings(&st)?;
        let ip = api::ip_address_ptr(&h.address);
        if was_cloud {
            client
                .update_host(
                    &h.id,
                    HostPatch {
                        name: Some(h.name.clone()),
                        ip_address: ip.clone(),
                        port: Some(h.port),
                        username: Some(h.user.clone()),
                        billing_enabled: None,
                        billing_cycle: None,
                        billing_custom_days: None,
                        billing_renewal_at: None,
                        billing_amount: None,
                        billing_currency: None,
                        billing_auto_renew: None,
                        billing_notes: None,
                        billing_payer_id: None,
                    }
                    .with_billing(input.billing.as_ref()),
                )
                .await?;
            client.set_proxy(&h.id, h.proxy_enabled).await?;
            client.sync_host_tags_by_names(&h.id, &h.tags).await?;
            h.source = Source::Cloud;
        } else {
            let created = client
                .create_host(
                    HostWrite {
                        name: h.name.clone(),
                        ip_address: ip,
                        port: h.port,
                        username: h.user.clone(),
                        is_proxy_enabled: h.proxy_enabled,
                        billing_enabled: None,
                        billing_cycle: None,
                        billing_custom_days: None,
                        billing_renewal_at: None,
                        billing_amount: None,
                        billing_currency: None,
                        billing_auto_renew: None,
                        billing_notes: None,
                        billing_payer_id: None,
                    }
                    .with_billing(input.billing.as_ref()),
                )
                .await?;
            let old_id = h.id.clone();
            h.id = created.id;
            h.source = Source::Cloud;
            if let Some(addr) = created.ip_address {
                h.address = addr;
            }
            if old_id != h.id {
                if let Some(mut sec) = state.store.lock().get_secret(&old_id)? {
                    sec.host_id = h.id.clone();
                    state.store.lock().set_secret(&sec)?;
                }
                let _ = state.store.lock().delete_host(&old_id);
            }
            client.sync_host_tags_by_names(&h.id, &h.tags).await?;
        }
    }

    state.store.lock().upsert_host(h.clone())?;
    if let Some(sec) = input.secret {
        if !sec.payload.trim().is_empty() {
            state.store.lock().set_secret(&Secret {
                host_id: h.id.clone(),
                auth_type: sec.auth_type,
                payload: sec.payload,
            })?;
        }
    }
    state.store.lock().get_host(&h.id)
}

#[tauri::command]
pub async fn delete_host(state: State<'_, AppState>, id: String, from_cloud: bool) -> AppResult<()> {
    let st = state.store.lock().load_settings()?;
    let host = state.store.lock().get_host(&id)?;
    if from_cloud && host.source == Source::Cloud {
        let client = client_from_settings(&st)?;
        client.delete_host(&id).await?;
    }
    state.store.lock().delete_host(&id)
}

#[tauri::command]
pub async fn move_host(
    state: State<'_, AppState>,
    id: String,
    delta: i64,
) -> AppResult<Vec<Host>> {
    state.store.lock().move_host(&id, delta)?;
    let st = state.store.lock().load_settings()?;
    if valid_session_token(&st.api_key) {
        let hosts = state.store.lock().list_hosts()?;
        let cloud_ids: Vec<String> = hosts
            .into_iter()
            .filter(|h| h.source == Source::Cloud)
            .map(|h| h.id)
            .collect();
        if !cloud_ids.is_empty() {
            let client = Client::new(config::effective_core_url(&st.core_url), st.api_key);
            let _ = client.reorder_hosts(&cloud_ids).await;
        }
    }
    state.store.lock().list_hosts()
}

#[tauri::command]
pub async fn get_telemetry(state: State<'_, AppState>, host_id: String) -> AppResult<Telemetry> {
    let st = state.store.lock().load_settings()?;
    let client = client_from_settings(&st)?;
    match client.get_telemetry(&host_id).await {
        Ok(t) => Ok(t),
        Err(e) if e.code() == "2fa_required" || e.code() == "totp_required" => Err(
            AppError::two_fa(e.to_string(), &config::effective_web_url(&st.web_url)),
        ),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn get_telemetry_history(
    state: State<'_, AppState>,
    host_id: String,
) -> AppResult<Vec<Telemetry>> {
    let st = state.store.lock().load_settings()?;
    let client = client_from_settings(&st)?;
    match client.get_telemetry_history(&host_id).await {
        Ok(t) => Ok(t),
        Err(e) if e.code() == "2fa_required" || e.code() == "totp_required" => Err(
            AppError::two_fa(e.to_string(), &config::effective_web_url(&st.web_url)),
        ),
        Err(e) => Err(e),
    }
}

fn billing_err(e: AppError, web: &str) -> AppError {
    if e.code() == "2fa_required" || e.code() == "totp_required" {
        AppError::two_fa(e.to_string(), web)
    } else {
        e
    }
}

#[tauri::command]
pub async fn billing_calendar(
    state: State<'_, AppState>,
    year: i32,
    month: i32,
    payer_id: Option<String>,
) -> AppResult<BillingCalendarResponse> {
    let st = state.store.lock().load_settings()?;
    let web = config::effective_web_url(&st.web_url);
    client_from_settings(&st)?
        .billing_calendar(year, month, payer_id.as_deref())
        .await
        .map_err(|e| billing_err(e, &web))
}

#[tauri::command]
pub async fn billing_summary(
    state: State<'_, AppState>,
    from: String,
    to: String,
    payer_id: Option<String>,
) -> AppResult<BillingSummaryResponse> {
    let st = state.store.lock().load_settings()?;
    let web = config::effective_web_url(&st.web_url);
    client_from_settings(&st)?
        .billing_summary(&from, &to, payer_id.as_deref())
        .await
        .map_err(|e| billing_err(e, &web))
}

#[tauri::command]
pub async fn billing_payers(state: State<'_, AppState>) -> AppResult<Vec<BillingPayer>> {
    let st = state.store.lock().load_settings()?;
    client_from_settings(&st)?.list_payers().await
}

#[tauri::command]
pub async fn billing_payer(state: State<'_, AppState>, id: String) -> AppResult<BillingPayerDetail> {
    let st = state.store.lock().load_settings()?;
    client_from_settings(&st)?.get_payer(&id).await
}

#[tauri::command]
pub async fn billing_create_payer(
    state: State<'_, AppState>,
    name: String,
    notes: Option<String>,
) -> AppResult<BillingPayer> {
    let st = state.store.lock().load_settings()?;
    client_from_settings(&st)?
        .create_payer(&name, notes.as_deref())
        .await
}

#[tauri::command]
pub async fn billing_update_payer(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    notes: Option<String>,
) -> AppResult<BillingPayer> {
    let st = state.store.lock().load_settings()?;
    client_from_settings(&st)?
        .update_payer(&id, name.as_deref(), Some(notes.as_deref()))
        .await
}

#[tauri::command]
pub async fn billing_delete_payer(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let st = state.store.lock().load_settings()?;
    client_from_settings(&st)?.delete_payer(&id).await
}

#[tauri::command]
pub async fn billing_advance(state: State<'_, AppState>, host_id: String) -> AppResult<()> {
    let st = state.store.lock().load_settings()?;
    let web = config::effective_web_url(&st.web_url);
    client_from_settings(&st)?
        .billing_advance(&host_id)
        .await
        .map(|_| ())
        .map_err(|e| billing_err(e, &web))
}

#[tauri::command]
pub async fn connect_host(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<db::ConnectResult> {
    let (host, secret, st) = {
        let store = state.store.lock();
        (
            store.get_host(&host_id)?,
            store.get_secret(&host_id)?,
            store.load_settings()?,
        )
    };
    let web = config::effective_web_url(&st.web_url);
    let proxy = host.proxy_enabled;
    let ws_url = if proxy {
        if !host.agent_online {
            return Err(AppError::msg(format!("agent offline for {}", host.name)));
        }
        let client = client_from_settings(&st)?;
        Some(client.ws_proxy_url(&host.id)?)
    } else {
        None
    };
    let mode = if proxy { "proxy" } else { "direct" };
    let session_id = ssh::start_session(
        app,
        ssh::ConnectParams {
            host,
            secret,
            cols,
            rows,
            proxy,
            ws_url,
            web_url: web,
        },
        Arc::clone(&state.sessions),
    )
    .await?;
    Ok(db::ConnectResult {
        session_id,
        mode: mode.into(),
    })
}

#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    let bytes = B64
        .decode(data.as_bytes())
        .map_err(|_| AppError::msg("invalid payload"))?;
    let tx = {
        let map = state.sessions.lock().await;
        map.get(&session_id)
            .map(|s| s.stdin.clone())
            .ok_or_else(|| AppError::msg("session not found"))?
    };
    tx.send(bytes)
        .await
        .map_err(|_| AppError::msg("session closed"))?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let map = state.sessions.lock().await;
    ssh::resize_session(&map, &session_id, cols, rows)
}

#[tauri::command]
pub async fn ssh_close(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    let map = state.sessions.lock().await;
    ssh::close_session(&map, &session_id)
}

fn sftp_dial_parts(
    state: &AppState,
    host_id: &str,
) -> AppResult<(db::Host, Option<db::Secret>, bool, Option<String>, String)> {
    let store = state.store.lock();
    let host = store.get_host(host_id)?;
    let secret = store.get_secret(host_id)?;
    let st = store.load_settings()?;
    let web = config::effective_web_url(&st.web_url);
    let proxy = host.proxy_enabled;
    let ws_url = if proxy {
        if !host.agent_online {
            return Err(AppError::msg(format!("agent offline for {}", host.name)));
        }
        let client = client_from_settings(&st)?;
        Some(client.ws_proxy_url(&host.id)?)
    } else {
        None
    };
    Ok((host, secret, proxy, ws_url, web))
}

#[tauri::command]
pub async fn sftp_connect(
    state: State<'_, AppState>,
    host_id: String,
) -> AppResult<ssh::SftpConnectResult> {
    let (host, secret, proxy, ws_url, web) = sftp_dial_parts(&state, &host_id)?;
    ssh::sftp::connect(host, secret, proxy, ws_url, web, state.sftp.as_ref()).await
}

#[tauri::command]
pub async fn sftp_close(state: State<'_, AppState>, host_id: String) -> AppResult<()> {
    ssh::sftp::close(&host_id, state.sftp.as_ref()).await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> AppResult<ssh::FsListing> {
    ssh::sftp::list(&host_id, &path, state.sftp.as_ref()).await
}

#[tauri::command]
pub async fn sftp_mkdir(state: State<'_, AppState>, host_id: String, path: String) -> AppResult<()> {
    ssh::sftp::mkdir(&host_id, &path, state.sftp.as_ref()).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    host_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    ssh::sftp::rename(&host_id, &from, &to, state.sftp.as_ref()).await
}

#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    is_dir: bool,
) -> AppResult<()> {
    ssh::sftp::remove(&host_id, &path, is_dir, state.sftp.as_ref()).await
}

#[tauri::command]
pub async fn sftp_transfer(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    direction: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> AppResult<()> {
    let token = CancellationToken::new();
    {
        let mut map = state.transfers.lock().await;
        map.insert(transfer_id.clone(), token.clone());
    }

    let res = ssh::sftp::transfer(
        &app,
        &host_id,
        &direction,
        &local_path,
        &remote_path,
        &transfer_id,
        &token,
        state.sftp.as_ref(),
    )
    .await;

    {
        let mut map = state.transfers.lock().await;
        map.remove(&transfer_id);
    }

    res
}

#[tauri::command]
pub async fn sftp_cancel(state: State<'_, AppState>, transfer_id: String) -> AppResult<()> {
    let tok = {
        let map = state.transfers.lock().await;
        map.get(&transfer_id).cloned()
    };
    if let Some(tok) = tok {
        tok.cancel();
    }
    Ok(())
}

#[tauri::command]
pub fn fs_home() -> AppResult<String> {
    ssh::localfs::home_dir()
}

#[tauri::command]
pub async fn fs_list(path: String) -> AppResult<ssh::FsListing> {
    ssh::localfs::list(&path).await
}

#[tauri::command]
pub async fn fs_mkdir(path: String) -> AppResult<()> {
    ssh::localfs::mkdir(&path).await
}

#[tauri::command]
pub async fn fs_rename(from: String, to: String) -> AppResult<()> {
    ssh::localfs::rename(&from, &to).await
}

#[tauri::command]
pub async fn fs_remove(path: String) -> AppResult<()> {
    ssh::localfs::remove(&path).await
}

#[tauri::command]
pub async fn fs_copy(from: String, to: String) -> AppResult<()> {
    ssh::localfs::copy_local(&from, &to).await
}

#[tauri::command]
pub fn export_vortex(state: State<'_, AppState>, path: String, password: String) -> AppResult<()> {
    let bundle = state.store.lock().export_bundle()?;
    let raw = serde_json::to_vec(&bundle)?;
    let sealed = crypto::seal_vortex(&password, &raw)?;
    std::fs::write(&path, sealed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub fn import_vortex(
    state: State<'_, AppState>,
    path: String,
    password: String,
    overwrite: bool,
) -> AppResult<i64> {
    let data = std::fs::read(&path)?;
    let plain = crypto::open_vortex(&password, &data)?;
    let bundle: db::ExportBundle = serde_json::from_slice(&plain)?;
    db::import_bundle(&state.store.lock(), bundle, overwrite)
}

#[tauri::command]
pub fn open_web_path(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let st = state.store.lock().load_settings()?;
    let base = config::effective_web_url(&st.web_url);
    let path = path.trim_start_matches('/');
    let url = format!("{base}/{path}");
    open::that(&url).map_err(|e| AppError::msg(e.to_string()))
}
