#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use futures_util::StreamExt;
use serde::Serialize;
use std::fs::File;
use std::io::Write;
use tauri::{ipc::Channel, AppHandle, Manager};

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
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to fetch file: {}", e))?;

    let total_size = response
        .content_length()
        .ok_or("Failed to get content length")?;

    let app_data_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data_path).map_err(|e| e.to_string())?;

    let db_path = app_data_path.join("bani.db");

    if db_path.exists() {
        on_event.send(DownloadEvent::Skipped {
            db_path: &db_path.to_string_lossy().to_string()
        });
        return Ok(db_path.to_string_lossy().to_string());
    }

    let mut dest = File::create(&db_path).map_err(|e| format!("File create error: {}", e))?;
    let mut stream = response.bytes_stream();

    let mut downloaded: u64 = 0;
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
        downloaded += chunk.len() as u64;

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            download_sqlite_file_with_channel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
