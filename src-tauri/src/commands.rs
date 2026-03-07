// src/commands.rs

use serde::{Serialize, Deserialize};
use tauri::{State, AppHandle};
use tokio::sync::Mutex;

use cpal::traits::{DeviceTrait, HostTrait};

use crate::soniox::{start_soniox_stream, stop_soniox_stream, SonioxStream};

//
// =============================
// Global App State
// =============================
//
pub struct StreamState {
    pub stream: Mutex<Option<SonioxStream>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pankti {
    pub gurmukhi: String,
    pub punjabi: String,
    pub english: String,
}

//
// =============================
// Update Pankti
// =============================
//
#[tauri::command]
pub async fn update_pankti(
    pankti: Pankti,
    state: State<'_, Mutex<Pankti>>
) -> Result<Pankti, String> {
    let mut pankti_state = state.lock().await;
    pankti_state.gurmukhi = pankti.gurmukhi.clone();
    pankti_state.punjabi = pankti.punjabi.clone();
    pankti_state.english = pankti.english.clone();

    Ok(pankti.clone())
}

//
// =============================
// Start Soniox
// =============================
//
#[tauri::command]
pub async fn start_soniox(
    app: AppHandle,
    api_key: String,
    mic_name: String,
    panktis: Vec<String>,
    state: State<'_, StreamState>,
) -> Result<(), String> {

    let mut guard = state.stream.lock().await;

    if guard.is_some() {
        return Err("Soniox stream already running".into());
    }

    let stream = start_soniox_stream(
        app,
        api_key,
        mic_name,
        panktis
    ).await?;

    *guard = Some(stream);

    println!("Soniox stream started");

    Ok(())
}

//
// =============================
// Stop Soniox
// =============================
//
#[tauri::command]
pub async fn stop_soniox(
    state: State<'_, StreamState>,
) -> Result<(), String> {

    let mut guard = state.stream.lock().await;

    if let Some(stream) = guard.take() {

        stop_soniox_stream(stream).await;

        println!("Soniox stream stopped");

        Ok(())

    } else {

        Err("Soniox stream not running".into())
    }
}

//
// =============================
// Restart Soniox
// =============================
//
#[tauri::command]
pub async fn restart_soniox(
    app: AppHandle,
    api_key: String,
    mic_name: String,
    panktis: Vec<String>,
    state: State<'_, StreamState>,
) -> Result<(), String> {

    //
    // Take existing stream first
    //
    let existing_stream = {
        let mut guard = state.stream.lock().await;
        guard.take()
    };

    //
    // Stop old stream if running
    //
    if let Some(stream) = existing_stream {

        println!("Stopping existing Soniox stream...");

        stop_soniox_stream(stream).await;
    }

    //
    // Start new stream
    //
    println!("Starting new Soniox stream...");

    let new_stream = start_soniox_stream(
        app,
        api_key,
        mic_name,
        panktis
    ).await?;

    //
    // Save new stream
    //
    let mut guard = state.stream.lock().await;
    *guard = Some(new_stream);

    println!("Soniox stream restarted");

    Ok(())
}

#[derive(Serialize)]
pub struct MicDevice {
    pub name: String,
}

#[tauri::command]
pub fn list_mics() -> Result<Vec<String>, String> {
    use cpal::traits::{HostTrait, DeviceTrait};

    let host = cpal::default_host();

    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to get input devices: {}", e))?;

    let mut mic_names = Vec::new();

    for device in devices {
        if let Ok(desc) = device.description() {
            let name = desc.name().to_string();

            match device.default_input_config() {
                Ok(config) => {
                    println!("Device: {}", name);
                    println!("Channels: {}", config.channels());
                    println!("Sample rate: {}", config.sample_rate());
                    println!("Sample format: {:?}", config.sample_format());
                }
                Err(e) => {
                    eprintln!("Error retrieving config for device {}: {}", name, e);
                }
            }

            mic_names.push(name);
        }
    }

    Ok(mic_names)
}