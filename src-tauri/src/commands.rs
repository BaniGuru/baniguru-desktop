// src/commands.rs

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use cpal::traits::{DeviceTrait, HostTrait};

use crate::audio_bus::AudioBus;
use crate::p2p_audio_sender::start_p2p_audio_stream_with_signaling;
use crate::p2p_audio_sender::ApiConfig;
use crate::soniox::{start_soniox_stream, stop_soniox_stream, SonioxStream};
use tauri::async_runtime::JoinHandle;

use cpal::SampleFormat;

#[derive(Clone, Copy, Debug)]
pub struct MicConfig {
    pub sample_rate: u32,
    pub channels: u16,
    pub format: SampleFormat,
}

//
// =============================
// Shared Audio State
// =============================
//
pub struct AudioState {
    pub bus: AudioBus,
    pub mic_stream: Mutex<Option<cpal::Stream>>,
    pub users: Mutex<u32>,
    pub mic_config: Mutex<Option<MicConfig>>,
}

//
// =============================
// Raw Stream State
// =============================
//
pub struct RawStreamState {
    pub running: Mutex<bool>,
    pub task: Mutex<Option<JoinHandle<()>>>,
}

//
// =============================
// Soniox State
// =============================
//
pub struct StreamState {
    pub stream: Mutex<Option<SonioxStream>>,
}

//
// =============================
// Pankti
// =============================
//
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pankti {
    pub gurmukhi: String,
    pub punjabi: String,
    pub english: String,
    pub page: String,
}

//
// =============================
// Update Pankti
// =============================
//
#[tauri::command]
pub async fn update_pankti(
    pankti: Pankti,
    state: State<'_, Mutex<Pankti>>,
) -> Result<Pankti, String> {
    let mut s = state.lock().await;

    *s = pankti.clone();

    Ok(pankti)
}

//
// =============================
// Start RAW Audio Stream
// =============================
//
#[tauri::command]
pub async fn start_stream(
    app: AppHandle,
    mic_name: String,
    wss_api_url: String,
    api_url: String,
    api_token: String,
    state: State<'_, RawStreamState>,
    audio: State<'_, AudioState>,
) -> Result<(), String> {

    let mut running = state.running.lock().await;

    if *running {
        return Err("Audio stream already running".into());
    }

    // Start mic (shared)
    acquire_mic(mic_name, &audio).await?;

    let mic_config = audio
        .mic_config
        .lock()
        .await
        .ok_or("Mic config missing")?;

    // Start audio sender
    let handle = start_p2p_audio_stream_with_signaling(
        app,
        mic_config.sample_rate,
        mic_config.channels,
        audio.bus.clone(),
        ApiConfig {
            wss_url: wss_api_url,
            url: api_url,
            token: api_token,
        },
    );

    *state.task.lock().await = Some(handle);

    *running = true;

    println!("Raw audio stream started");

    Ok(())
}

//
// =============================
// Stop RAW Audio Stream
// =============================
//
#[tauri::command]
pub async fn stop_stream(
    state: State<'_, RawStreamState>,
    audio: State<'_, AudioState>,
) -> Result<(), String> {

    let mut running = state.running.lock().await;

    if !*running {
        return Err("Stream not running".into());
    }

    *running = false;

    if let Some(task) = state.task.lock().await.take() {
        task.abort();
    }

    release_mic(&audio).await;

    println!("Raw audio stream stopped");

    Ok(())
}

//
// =============================
// Start Soniox
// =============================
//
#[tauri::command]
pub async fn start_soniox(
    app: AppHandle,
    soniox_url: String,
    api_key: String,
    mic_name: String,
    panktis: Vec<String>,
    state: State<'_, StreamState>,
    audio: State<'_, AudioState>,
) -> Result<(), String> {

    let mut guard = state.stream.lock().await;

    if guard.is_some() {
        return Err("Soniox already running".into());
    }

    // Ensure mic running
    acquire_mic(mic_name, &audio).await?;

    let mic_config = audio
        .mic_config
        .lock()
        .await
        .ok_or("Mic config missing")?;

    let stream_result = start_soniox_stream(
        app,
        soniox_url,
        api_key,
        panktis,
        mic_config.sample_rate,
        mic_config.channels,
        audio.bus.clone(),
    ).await;

    let stream = match stream_result {
        Ok(stream) => stream,
        Err(e) => {
            println!("Soniox stream failed, releasing mic: {}", e);

            release_mic(&audio).await;
            return Err(e);
        }
    };

    *guard = Some(stream);

    println!("Soniox started");

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
    audio: State<'_, AudioState>,
) -> Result<(), String> {

    let mut guard = state.stream.lock().await;

    if let Some(stream) = guard.take() {

        stop_soniox_stream(stream).await;

        release_mic(&audio).await;

        println!("Soniox stopped");

        Ok(())

    } else {

        Err("Soniox not running".into())
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
    soniox_url: String,
    api_key: String,
    mic_name: String,
    panktis: Vec<String>,
    state: State<'_, StreamState>,
    audio: State<'_, AudioState>,
) -> Result<(), String> {

    // Stop existing
    if let Some(stream) = state.stream.lock().await.take() {
        stop_soniox_stream(stream).await;
        release_mic(&audio).await;
    }

    // Start again
    acquire_mic(mic_name, &audio).await?;

    let mic_config = audio
        .mic_config
        .lock()
        .await
        .ok_or("Mic config missing")?;

    let new_stream = start_soniox_stream(
        app,
        soniox_url,
        api_key,
        panktis,
        mic_config.sample_rate,
        mic_config.channels,
        audio.bus.clone(),
    ).await?;

    *state.stream.lock().await = Some(new_stream);

    println!("Soniox restarted");

    Ok(())
}

//
// =============================
// List microphones
// =============================
//
#[tauri::command]
pub fn list_mics() -> Result<Vec<String>, String> {

    let host = cpal::default_host();

    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to get input devices: {}", e))?;

    let mut names = Vec::new();

    for d in devices {
        if let Ok(name) = d.name() {
            if d.default_input_config().is_ok() {
                names.push(name);
            }
        }
    }

    Ok(names)
}

//
// =============================
// MIC CONTROL
// =============================
//
pub async fn acquire_mic(
    mic_name: String,
    audio: &AudioState,
) -> Result<(), String> {

    let mut users = audio.users.lock().await;
    let mut mic = audio.mic_stream.lock().await;

    if mic.is_none() {

        println!("Starting microphone...");

        let host = cpal::default_host();

        let device = host
            .input_devices()
            .map_err(|e| format!("Failed to list devices: {}", e))?
            .find(|d| {
                d.name()
                    .map(|n| n.contains(&mic_name))
                    .unwrap_or(false)
            })
            .ok_or("Mic not found")?;

        let config = device.default_input_config().map_err(|e| e.to_string())?;

        let mic_config = MicConfig {
            sample_rate: config.sample_rate(),
            channels: config.channels(),
            format: config.sample_format(),
        };

        *audio.mic_config.lock().await = Some(mic_config);

        let stream = crate::soniox::start_microphone(
            &device,
            config,
            audio.bus.clone(),
        )?;

        *mic = Some(stream);
    }

    *users += 1;

    println!("Mic users: {}", *users);

    Ok(())
}

pub async fn release_mic(audio: &AudioState) {

    let mut users = audio.users.lock().await;
    let mut mic = audio.mic_stream.lock().await;

    if *users > 0 {
        *users -= 1;
    }

    println!("Mic users: {}", *users);

    if *users == 0 {
        println!("Stopping microphone");
        mic.take();
    }
}

//
// =============================
// Request admin permission
// =============================
//
#[tauri::command]
pub fn request_admin_permission() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let current_exe = std::env::current_exe()
            .map_err(|e| e.to_string())?;

        let status = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Start-Process -FilePath '{}' -ArgumentList '--admin-unlock-check' -Verb RunAs -Wait",
                    current_exe.display()
                ),
            ])
            .status()
            .map_err(|e| e.to_string())?;

        return Ok(status.success());
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let current_exe = std::env::current_exe()
            .map_err(|e| e.to_string())?;

        let status = Command::new("pkexec")
            .arg(current_exe)
            .arg("--admin-unlock-check")
            .status()
            .map_err(|e| e.to_string())?;

        return Ok(status.success());
    }

    #[allow(unreachable_code)]
    Ok(false)
}