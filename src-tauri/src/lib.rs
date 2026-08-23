mod api;
mod commands;
mod config;
mod crypto;
mod db;
mod error;
mod master_key;
mod ssh;

use std::sync::Arc;

use parking_lot::Mutex;
use tauri::Manager;

pub struct AppState {
    store: Mutex<db::Store>,
    sessions: Arc<tokio::sync::Mutex<ssh::SessionMap>>,
    sftp: Arc<tokio::sync::Mutex<ssh::SftpMap>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let paths = config::Paths::resolve().map_err(|e| e.to_string())?;
            config::ensure_dir(&paths.config_dir).map_err(|e| e.to_string())?;
            let master = master_key::resolve_master_key(&paths.config_dir)?;
            let store = db::Store::open(&paths.db_path, master)?;
            app.manage(AppState {
                store: Mutex::new(store),
                sessions: Arc::new(tokio::sync::Mutex::new(ssh::SessionMap::new())),
                sftp: Arc::new(tokio::sync::Mutex::new(ssh::SftpMap::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_hosts,
            commands::get_settings,
            commands::save_settings,
            commands::health,
            commands::get_me,
            commands::browser_login,
            commands::logout,
            commands::sync_cloud,
            commands::save_host,
            commands::delete_host,
            commands::move_host,
            commands::get_telemetry,
            commands::get_telemetry_history,
            commands::billing_calendar,
            commands::billing_summary,
            commands::billing_payers,
            commands::billing_payer,
            commands::billing_create_payer,
            commands::billing_update_payer,
            commands::billing_delete_payer,
            commands::billing_advance,
            commands::open_system_ssh,
            commands::connect_host,
            commands::ssh_write,
            commands::ssh_resize,
            commands::ssh_close,
            commands::sftp_connect,
            commands::sftp_close,
            commands::sftp_list,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_remove,
            commands::sftp_transfer,
            commands::fs_home,
            commands::fs_list,
            commands::fs_mkdir,
            commands::fs_rename,
            commands::fs_remove,
            commands::fs_copy,
            commands::export_vortex,
            commands::import_vortex,
            commands::open_web_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vortex GUI");
}
