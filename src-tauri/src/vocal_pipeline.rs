use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;
use hound::{SampleFormat, WavSpec, WavWriter};
use tauri::{async_runtime::JoinHandle, AppHandle, Manager};
use tokio::sync::watch;

use crate::audio_bus::AudioBus;

/// Captures and records the same microphone audio that Auto Pilot sends to ASR.
/// Audio is passed through directly; no vocal separation model runs in this path.
pub struct VocalAudioPipeline {
    audio_bus: AudioBus,
    recording: VocalRecording,
}

impl VocalAudioPipeline {
    pub fn start(
        app: &AppHandle,
        audio_bus: AudioBus,
        sample_rate: u32,
        channels: u16,
    ) -> Result<Self, String> {
        let music_dir = app
            .path()
            .audio_dir()
            .map_err(|error| format!("Could not find the user's Music folder: {error}"))?
            .join("BaniGuru");
        let recording = VocalRecording::start(
            music_dir,
            audio_bus.clone(),
            sample_rate,
            channels,
        )?;

        Ok(Self {
            audio_bus,
            recording,
        })
    }

    pub fn vocals_bus(&self) -> AudioBus {
        self.audio_bus.clone()
    }

    pub async fn stop(self) -> Result<PathBuf, String> {
        self.recording.stop().await
    }
}

struct VocalRecording {
    path: PathBuf,
    stop: watch::Sender<bool>,
    task: JoinHandle<Result<(), String>>,
}

impl VocalRecording {
    fn start(
        music_dir: PathBuf,
        audio_bus: AudioBus,
        sample_rate: u32,
        channels: u16,
    ) -> Result<Self, String> {
        fs::create_dir_all(&music_dir).map_err(|error| {
            format!("Could not create Music/BaniGuru recording folder: {error}")
        })?;
        let now = Local::now();
        let stem = format!(
            "BaniGuru_AutoPilot_{}_{:03}",
            now.format("%Y-%m-%d_%H-%M-%S"),
            now.timestamp_subsec_millis()
        );
        let path = unique_recording_path(&music_dir, &stem);
        let writer = WavWriter::create(
            &path,
            WavSpec {
                channels,
                sample_rate,
                bits_per_sample: 32,
                sample_format: SampleFormat::Float,
            },
        )
        .map_err(|error| format!("Could not create Auto Pilot audio recording: {error}"))?;
        let mut receiver = audio_bus.subscribe();
        let (stop, mut stop_rx) = watch::channel(false);
        let worker_path = path.clone();
        let task = tauri::async_runtime::spawn(async move {
            let mut writer = Some(writer);
            loop {
                tokio::select! {
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() {
                            while let Ok(chunk) = receiver.try_recv() {
                                write_audio_chunk(writer.as_mut().expect("recording writer"), &chunk)?;
                            }
                            break;
                        }
                    }
                    chunk = receiver.recv() => {
                        let Some(chunk) = chunk else { break; };
                        write_audio_chunk(writer.as_mut().expect("recording writer"), &chunk)?;
                    }
                }
            }
            writer
                .take()
                .expect("recording writer")
                .finalize()
                .map_err(|error| format!("Could not finalize Auto Pilot recording: {error}"))?;
            Ok(())
        });

        println!("Recording Auto Pilot audio to {}", worker_path.display());
        Ok(Self { path, stop, task })
    }

    async fn stop(self) -> Result<PathBuf, String> {
        let _ = self.stop.send(true);
        match self.task.await {
            Ok(Ok(())) => Ok(self.path),
            Ok(Err(error)) => Err(error),
            Err(error) => Err(format!("Auto Pilot recording stopped unexpectedly: {error}")),
        }
    }
}

fn write_audio_chunk(
    writer: &mut WavWriter<std::io::BufWriter<std::fs::File>>,
    chunk: &[f32],
) -> Result<(), String> {
    for sample in chunk {
        writer
            .write_sample(*sample)
            .map_err(|error| format!("Could not write Auto Pilot recording: {error}"))?;
    }
    Ok(())
}

fn unique_recording_path(folder: &Path, stem: &str) -> PathBuf {
    let initial = folder.join(format!("{stem}.wav"));
    if !initial.exists() {
        return initial;
    }
    for suffix in 1..u32::MAX {
        let candidate = folder.join(format!("{stem}_{suffix:03}.wav"));
        if !candidate.exists() {
            return candidate;
        }
    }
    initial
}
