#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod audio_bus;
mod commands;
mod offline_asr;
mod p2p_audio_sender;
mod server;
mod settings;
mod soniox;
mod vocal_pipeline;
mod webrtc;

use crate::audio_bus::AudioBus;
use crate::commands::list_mics;
use crate::commands::update_pankti;
use crate::commands::Pankti;
use crate::commands::{
    request_admin_permission, restart_soniox, start_offline_asr, start_soniox, start_stream,
    stop_offline_asr, stop_soniox, stop_stream, AudioState, OfflineAsrState, RawStreamState,
    StreamState, VocalPipelineState,
};
use crate::server::start_web_server;
use serde::Serialize;
use std::env;
use std::fs::File;
use std::fs::OpenOptions;
use std::io::{copy, Write};
use std::panic;
use std::path::PathBuf;
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum DownloadEvent<'a> {
    Started {
        url: &'a str,
        download_id: usize,
        content_length: usize,
    },
    Progress {
        download_id: usize,
        chunk_length: usize,
    },
    Finished {
        download_id: usize,
    },
    Skipped {
        db_path: &'a str,
    },
}

#[tauri::command]
fn get_local_ip() -> Result<String, String> {
    match local_ip_address::local_ip() {
        Ok(ip) => Ok(ip.to_string()),
        Err(e) => Err(format!("Failed to get local IP: {}", e)),
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn install_bundled_database_with_channel<'a>(
    app: AppHandle,
    on_event: Channel<DownloadEvent<'a>>,
) -> Result<String, String> {
    let app_data_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data_path).map_err(|e| e.to_string())?;

    let db_path = app_data_path.join("bani.db");

    const DATABASE_ASSET_REVISION: &str =
        "fad20604c7a067adaa177d4d8a38d29acab47c347eb97044d811740c6b4f15b2";
    let revision_path = app_data_path.join(".bani-db-revision");
    let installed_revision = std::fs::read_to_string(&revision_path).unwrap_or_default();
    if db_path.exists() && installed_revision.trim() == DATABASE_ASSET_REVISION {
        let _ = on_event.send(DownloadEvent::Skipped {
            db_path: &db_path.to_string_lossy().to_string(),
        });
        return Ok(db_path.to_string_lossy().to_string());
    }

    let bundled_db = app
        .path()
        .resolve("bani.db", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Could not resolve bundled database: {e}"))?;
    let total_size = std::fs::metadata(&bundled_db)
        .map_err(|e| format!("Could not read bundled database: {e}"))?
        .len();
    let temporary_path = app_data_path.join("bani.db.installing");
    let mut source =
        File::open(&bundled_db).map_err(|e| format!("Could not open bundled database: {e}"))?;
    let mut dest = File::create(&temporary_path)
        .map_err(|e| format!("Could not create database copy: {e}"))?;

    on_event
        .send(DownloadEvent::Started {
            url: "Bundled Bani database",
            download_id: 1,
            content_length: total_size as usize,
        })
        .map_err(|e| e.to_string())?;

    let copied = copy(&mut source, &mut dest)
        .map_err(|e| format!("Could not copy bundled database: {e}"))?;
    if copied != total_size {
        return Err(format!(
            "Bundled database copy was incomplete: {copied}/{total_size} bytes"
        ));
    }
    dest.sync_all()
        .map_err(|e| format!("Could not flush database copy: {e}"))?;
    drop(dest);
    std::fs::rename(&temporary_path, &db_path)
        .map_err(|e| format!("Could not install bundled database: {e}"))?;
    std::fs::write(&revision_path, DATABASE_ASSET_REVISION)
        .map_err(|e| format!("Could not record database revision: {e}"))?;

    on_event
        .send(DownloadEvent::Progress {
            download_id: 1,
            chunk_length: total_size as usize,
        })
        .map_err(|e| e.to_string())?;

    on_event
        .send(DownloadEvent::Finished { download_id: 1 })
        .map_err(|e| e.to_string())?;

    Ok(db_path.to_string_lossy().to_string())
}

#[tauri::command]
fn fake_fullscreen(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No monitor found")?;

    let size = monitor.size();

    #[cfg(target_os = "linux")]
    {
        window.show().ok();
        window.unmaximize().ok();
        window.set_decorations(false).ok();
        window.set_fullscreen(true).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        window.unmaximize().ok();
        window.set_decorations(false).map_err(|e| e.to_string())?;
        window.set_shadow(false).ok();

        let position = monitor.position();

        window.set_position(*position).map_err(|e| e.to_string())?;
        window.set_size(*size).map_err(|e| e.to_string())?;
    }

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}

fn crash_log_path() -> PathBuf {
    let home = env::var("USERPROFILE").unwrap_or_else(|_| ".".into());

    PathBuf::from(home).join("gurbani-explorer-crash.log")
}

fn install_panic_logger() {
    panic::set_hook(Box::new(|panic_info| {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(crash_log_path())
            .unwrap();

        let location = panic_info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".into());

        let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            *s
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.as_str()
        } else {
            "unknown panic"
        };

        let _ = writeln!(
            file,
            "\n=== PANIC ===\nLocation: {}\nMessage: {}\n",
            location, payload
        );
    }));
}

fn main() {
    if std::env::args().any(|arg| arg == "--admin-unlock-check") {
        std::process::exit(0);
    }

    install_panic_logger();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_keyring::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            install_bundled_database_with_channel,
            update_pankti,
            get_local_ip,
            start_soniox,
            stop_soniox,
            restart_soniox,
            start_offline_asr,
            stop_offline_asr,
            start_stream,
            stop_stream,
            list_mics,
            fake_fullscreen,
            request_admin_permission,
        ])
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.show().map_err(|e| e.to_string())?;
                    window.set_focus().ok();
                }
            }

            let app_handle = app.handle().clone();

            let config_path = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app_data_dir: {e}"))?
                .join("settings.json");

            // Create initial Pankti data
            let pankti = Pankti {
                gurmukhi: "".to_string(),
                punjabi: "".to_string(),
                english: "".to_string(),
                page: "search".to_string(),
            };

            app.manage(Mutex::new(pankti));
            app.manage(config_path);
            app.manage(StreamState {
                stream: Mutex::new(None),
            });
            app.manage(OfflineAsrState {
                stream: Mutex::new(None),
            });
            app.manage(VocalPipelineState {
                pipeline: Mutex::new(None),
            });
            app.manage(AudioState {
                bus: AudioBus::new(),
                mic_stream: Mutex::new(None),
                mic_config: Mutex::new(None),
                users: Mutex::new(0),
            });
            app.manage(RawStreamState {
                running: Mutex::new(false),
                task: Mutex::new(None),
            });

            // Spawn async task with cloned Arc<Mutex<Pankti>>
            tauri::async_runtime::spawn(async move {
                start_web_server(app_handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
