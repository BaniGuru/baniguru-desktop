#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod audio_bus;
mod commands;
mod p2p_audio_sender;
mod server;
mod settings;
mod soniox;
mod webrtc;

use crate::audio_bus::AudioBus;
use crate::commands::list_mics;
use crate::commands::update_pankti;
use crate::commands::Pankti;
use crate::commands::{
    restart_soniox, start_soniox, start_stream, stop_soniox, stop_stream, AudioState,
    RawStreamState, StreamState,
};
use crate::server::start_web_server;
use futures_util::StreamExt;
use serde::Serialize;
use std::env;
use std::fs::File;
use std::fs::OpenOptions;
use std::io::Write;
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
async fn download_sqlite_file_with_channel<'a>(
    url: String,
    app: AppHandle,
    on_event: Channel<DownloadEvent<'a>>,
) -> Result<String, String> {
    let app_data_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data_path).map_err(|e| e.to_string())?;

    let db_path = app_data_path.join("bani.db");

    if db_path.exists() {
        let _ = on_event.send(DownloadEvent::Skipped {
            db_path: &db_path.to_string_lossy().to_string(),
        });
        return Ok(db_path.to_string_lossy().to_string());
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to fetch file: {}", e))?;

    let total_size = response
        .content_length()
        .ok_or("Failed to get content length")?;

    let mut dest = File::create(&db_path).map_err(|e| format!("File create error: {}", e))?;
    let mut stream = response.bytes_stream();

    let download_id = 1;

    // Send started event
    on_event
        .send(DownloadEvent::Started {
            url: &url,
            download_id,
            content_length: total_size as usize,
        })
        .map_err(|e| e.to_string())?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        dest.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;

        on_event
            .send(DownloadEvent::Progress {
                download_id,
                chunk_length: chunk.len(),
            })
            .map_err(|e| e.to_string())?;
    }

    on_event
        .send(DownloadEvent::Finished { download_id })
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

    let position = monitor.position();
    let size = monitor.size();

    window.unmaximize().ok();
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_shadow(false).ok();

    window.set_position(*position).map_err(|e| e.to_string())?;
    window.set_size(*size).map_err(|e| e.to_string())?;

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
    install_panic_logger();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            download_sqlite_file_with_channel,
            update_pankti,
            get_local_ip,
            start_soniox,
            stop_soniox,
            restart_soniox,
            start_stream,
            stop_stream,
            list_mics,
            fake_fullscreen,
        ])
        .setup(|app| {
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
