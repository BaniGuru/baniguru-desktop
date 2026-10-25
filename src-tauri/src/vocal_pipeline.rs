use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::Local;
use hound::{SampleFormat, WavSpec, WavWriter};
use tauri::{async_runtime::JoinHandle, AppHandle, Manager};
use tokio::sync::watch;

use crate::audio_bus::AudioBus;
use crate::offline_asr::audio::{resample_to_16k, to_mono, TARGET_SAMPLE_RATE};

const RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Normalize once, then share the same 16 kHz mono samples with ASR and the
/// optional PCM recorder. No vocal separation or MP3 encoder runs here.
pub struct VocalAudioPipeline {
    audio_bus: AudioBus,
    recording: Option<VocalRecording>,
    shutdown: watch::Sender<bool>,
    task: Option<JoinHandle<()>>,
}

fn music_folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .audio_dir()
        .map(|path| path.join("BaniGuru"))
        .map_err(|error| format!("Could not find the user's Music folder: {error}"))
}

impl VocalAudioPipeline {
    pub fn start(
        app: &AppHandle,
        input: AudioBus,
        sample_rate: u32,
        channels: u16,
        recording: bool,
    ) -> Result<Self, String> {
        let folder = if recording {
            Some(music_folder(app)?)
        } else {
            None
        };
        Self::start_in_folder(input, sample_rate, channels, folder)
    }

    fn start_in_folder(
        input: AudioBus,
        sample_rate: u32,
        channels: u16,
        folder: Option<PathBuf>,
    ) -> Result<Self, String> {
        let audio_bus = AudioBus::new();
        let recording = folder
            .map(|folder| VocalRecording::start(folder, audio_bus.clone()))
            .transpose()?;
        let mut receiver = input.subscribe();
        let output = audio_bus.clone();
        let (shutdown, mut stop) = watch::channel(false);
        let task = tauri::async_runtime::spawn(async move {
            let publish = |chunk: Vec<f32>| {
                let audio = resample_to_16k(&to_mono(&chunk, channels), sample_rate);
                output.publish(audio);
            };
            loop {
                tokio::select! {
                    biased;
                    _ = stop.changed() => {
                        // Capture the queue length at the user's stop boundary;
                        // a microphone still in use by Audio Stream cannot keep
                        // extending this recording while we drain it.
                        let queued = receiver.len();
                        for _ in 0..queued {
                            if let Ok(chunk) = receiver.try_recv() { publish(chunk); }
                        }
                        break;
                    }
                    chunk = receiver.recv() => {
                        let Some(chunk) = chunk else { break; };
                        publish(chunk);
                    }
                }
            }
        });
        Ok(Self {
            audio_bus,
            recording,
            shutdown,
            task: Some(task),
        })
    }

    pub fn vocals_bus(&self) -> AudioBus {
        self.audio_bus.clone()
    }

    pub fn recording_path(&self) -> Option<&Path> {
        self.recording
            .as_ref()
            .map(|recording| recording.path.as_path())
    }

    pub async fn set_recording(
        &mut self,
        app: &AppHandle,
        enabled: bool,
    ) -> Result<Option<PathBuf>, String> {
        let folder = if enabled && self.recording.is_none() {
            Some(music_folder(app)?)
        } else {
            None
        };
        self.set_recording_in_folder(enabled, folder).await
    }

    async fn set_recording_in_folder(
        &mut self,
        enabled: bool,
        folder: Option<PathBuf>,
    ) -> Result<Option<PathBuf>, String> {
        if !enabled {
            if let Some(recording) = self.recording.take() {
                return recording.stop().await.map(Some);
            }
        } else if self.recording.is_none() {
            self.recording = Some(VocalRecording::start(
                folder.ok_or("Recording folder missing")?,
                self.audio_bus.clone(),
            )?);
        }
        Ok(None)
    }

    pub async fn stop_audio(&mut self) {
        if let Some(task) = self.task.take() {
            let _ = self.shutdown.send(true);
            let _ = task.await;
        }
    }

    pub async fn stop(mut self) -> Result<Option<PathBuf>, String> {
        self.stop_audio().await;
        self.set_recording_in_folder(false, None).await
    }
}

struct VocalRecording {
    path: PathBuf,
    stop: watch::Sender<bool>,
    task: JoinHandle<Result<(), String>>,
}

impl VocalRecording {
    fn start(music_dir: PathBuf, audio_bus: AudioBus) -> Result<Self, String> {
        fs::create_dir_all(&music_dir).map_err(|error| {
            format!("Could not create Music/BaniGuru recording folder: {error}")
        })?;
        // Retention is best effort; a locked old file must not prevent ASR
        // or a new recording from starting.
        if let Err(error) = purge_old_recordings(&music_dir, None, SystemTime::now()) {
            eprintln!("Recording cleanup: {error}");
        }
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
                channels: 1,
                sample_rate: TARGET_SAMPLE_RATE,
                bits_per_sample: 16,
                sample_format: SampleFormat::Int,
            },
        )
        .map_err(|error| format!("Could not create Auto Pilot audio recording: {error}"))?;
        let mut receiver = audio_bus.subscribe();
        let (stop, mut stop_rx) = watch::channel(false);
        let task = tauri::async_runtime::spawn(async move {
            let mut writer = writer;
            loop {
                tokio::select! {
                    biased;
                    _ = stop_rx.changed() => {
                        let queued = receiver.len();
                        for _ in 0..queued {
                            if let Ok(chunk) = receiver.try_recv() { write_audio_chunk(&mut writer, &chunk)?; }
                        }
                        break;
                    }
                    chunk = receiver.recv() => {
                        let Some(chunk) = chunk else { break; };
                        write_audio_chunk(&mut writer, &chunk)?;
                    }
                }
            }
            writer
                .finalize()
                .map_err(|error| format!("Could not finalize Auto Pilot recording: {error}"))?;
            Ok(())
        });
        println!(
            "Recording 16 kHz mono Auto Pilot audio to {}",
            path.display()
        );
        Ok(Self { path, stop, task })
    }

    async fn stop(self) -> Result<PathBuf, String> {
        let _ = self.stop.send(true);
        match self.task.await {
            Ok(Ok(())) => Ok(self.path),
            Ok(Err(error)) => Err(error),
            Err(error) => Err(format!(
                "Auto Pilot recording stopped unexpectedly: {error}"
            )),
        }
    }
}

fn write_audio_chunk(
    writer: &mut WavWriter<std::io::BufWriter<std::fs::File>>,
    chunk: &[f32],
) -> Result<(), String> {
    for sample in chunk {
        let pcm = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer
            .write_sample(pcm)
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

/// Only app-named WAV/MP3 files in Music/BaniGuru are eligible. Symlinks,
/// directories, unrelated files and the active recording are never removed.
pub(crate) fn purge_old_recordings(
    folder: &Path,
    active: Option<&Path>,
    now: SystemTime,
) -> Result<usize, String> {
    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!(
                "Could not inspect old Auto Pilot recordings: {error}"
            ))
        }
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if active == Some(path.as_path())
            || !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
        {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.starts_with("BaniGuru_AutoPilot_")
            || !matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("wav" | "mp3")
            )
        {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map_err(|error| error.to_string())?;
        if now.duration_since(modified).unwrap_or_default() > RETENTION {
            fs::remove_file(&path).map_err(|error| {
                format!("Could not remove old recording {}: {error}", path.display())
            })?;
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn start_recording_retention(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(24 * 60 * 60));
        loop {
            interval.tick().await; // first tick runs immediately at app startup
            let folder = match music_folder(&app) {
                Ok(folder) => folder,
                Err(error) => {
                    eprintln!("Recording cleanup: {error}");
                    continue;
                }
            };
            let active = app
                .state::<crate::commands::VocalPipelineState>()
                .pipeline
                .lock()
                .await
                .as_ref()
                .and_then(|pipeline| pipeline.recording_path().map(Path::to_path_buf));
            let result = tokio::task::spawn_blocking(move || {
                purge_old_recordings(&folder, active.as_deref(), SystemTime::now())
            })
            .await;
            if let Ok(Err(error)) = result {
                eprintln!("Recording cleanup: {error}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, FileTimes};
    use std::time::Instant;

    fn folder(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "baniguru-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[tokio::test]
    async fn recording_is_the_same_normalized_audio_as_asr_in_small_pcm_format() {
        let path = folder("pcm");
        let input = AudioBus::new();
        let pipeline =
            VocalAudioPipeline::start_in_folder(input.clone(), 48_000, 2, Some(path.clone()))
                .unwrap();
        let mut asr = pipeline.vocals_bus().subscribe();
        let raw: Vec<f32> = (0..48_000).flat_map(|_| [0.125, 0.375]).collect();
        input.publish(raw);
        let samples = tokio::time::timeout(Duration::from_secs(2), asr.recv())
            .await
            .unwrap()
            .unwrap();
        let file = pipeline.stop().await.unwrap().unwrap();
        let mut wav = hound::WavReader::open(&file).unwrap();
        assert_eq!(wav.spec().sample_rate, 16_000);
        assert_eq!(wav.spec().channels, 1);
        assert_eq!(wav.spec().bits_per_sample, 16);
        let recorded: Vec<i16> = wav.samples().map(Result::unwrap).collect();
        assert_eq!(recorded.len(), samples.len());
        assert_eq!(recorded.len(), 16_000);
        for (pcm, audio) in recorded.iter().zip(samples) {
            assert!((*pcm as f32 / i16::MAX as f32 - audio).abs() <= 1.0 / i16::MAX as f32);
        }
        assert!(fs::metadata(file).unwrap().len() <= 32_100);
        fs::remove_dir_all(path).unwrap();
    }

    #[tokio::test]
    async fn live_recording_switch_does_not_restart_or_interrupt_asr() {
        let path = folder("toggle");
        let input = AudioBus::new();
        let mut pipeline =
            VocalAudioPipeline::start_in_folder(input.clone(), 16_000, 1, None).unwrap();
        let mut asr = pipeline.vocals_bus().subscribe();
        input.publish(vec![0.2; 1600]);
        assert_eq!(asr.recv().await.unwrap().len(), 1600);
        assert!(!path.exists());
        pipeline
            .set_recording_in_folder(true, Some(path.clone()))
            .await
            .unwrap();
        let first = pipeline.recording_path().unwrap().to_path_buf();
        input.publish(vec![0.3; 1600]);
        assert_eq!(asr.recv().await.unwrap().len(), 1600);
        assert_eq!(
            pipeline.set_recording_in_folder(false, None).await.unwrap(),
            Some(first.clone())
        );
        input.publish(vec![0.4; 1600]);
        assert_eq!(asr.recv().await.unwrap().len(), 1600);
        pipeline
            .set_recording_in_folder(true, Some(path.clone()))
            .await
            .unwrap();
        input.publish(vec![0.5; 1600]);
        assert_eq!(asr.recv().await.unwrap().len(), 1600);
        let second = pipeline.stop().await.unwrap().unwrap();
        assert_ne!(first, second);
        for file in [first, second] {
            assert_eq!(hound::WavReader::open(file).unwrap().duration(), 1600);
        }
        assert_eq!(fs::read_dir(&path).unwrap().count(), 2);
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn retention_removes_only_expired_app_recordings_and_preserves_active_files() {
        let path = folder("retention");
        fs::create_dir_all(&path).unwrap();
        let now = SystemTime::now();
        let make = |name: &str, age: Duration| {
            let p = path.join(name);
            let f = File::create(&p).unwrap();
            f.set_times(FileTimes::new().set_modified(now - age))
                .unwrap();
            p
        };
        let old = RETENTION + Duration::from_secs(60);
        let expired = make("BaniGuru_AutoPilot_old.wav", old);
        let mp3 = make("BaniGuru_AutoPilot_old.mp3", old);
        let active = make("BaniGuru_AutoPilot_active.wav", old);
        let recent = make("BaniGuru_AutoPilot_recent.wav", Duration::from_secs(60));
        let boundary = make("BaniGuru_AutoPilot_boundary.wav", RETENTION);
        let unrelated = make("my-personal-recording.wav", old);
        let document = make("BaniGuru_AutoPilot_notes.txt", old);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&unrelated, path.join("BaniGuru_AutoPilot_link.wav")).unwrap();
        assert_eq!(purge_old_recordings(&path, Some(&active), now).unwrap(), 2);
        assert!(!expired.exists() && !mp3.exists());
        for keep in [active, recent, boundary, unrelated, document] {
            assert!(keep.exists());
        }
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    #[ignore = "set BANI_RECORDING_AUDIO to benchmark conversion and PCM writing on a full recording"]
    fn full_recording_pcm_conversion_cost() {
        let source = std::env::var("BANI_RECORDING_AUDIO").unwrap();
        let raw = std::process::Command::new("ffmpeg")
            .args([
                "-v", "error", "-i", &source, "-f", "f32le", "-ar", "48000", "-ac", "2", "pipe:1",
            ])
            .output()
            .unwrap();
        assert!(raw.status.success());
        let dir = folder("full-pcm");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("recording.wav");
        let mut writer = WavWriter::create(
            &path,
            WavSpec {
                channels: 1,
                sample_rate: 16_000,
                bits_per_sample: 16,
                sample_format: SampleFormat::Int,
            },
        )
        .unwrap();
        let start = Instant::now();
        let mut samples = 0;
        for bytes in raw.stdout.chunks(256 * 2 * 4) {
            let input: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect();
            let audio = resample_to_16k(&to_mono(&input, 2), 48_000);
            samples += audio.len();
            write_audio_chunk(&mut writer, &audio).unwrap();
        }
        writer.finalize().unwrap();
        println!(
            "RECORDING_COST {}",
            serde_json::json!({"input_seconds":raw.stdout.len() as f64/(48000.0*2.0*4.0),"processing_seconds":start.elapsed().as_secs_f64(),"wav_bytes":fs::metadata(&path).unwrap().len(),"recorded_samples":samples,"format":"16 kHz mono 16-bit PCM"})
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
