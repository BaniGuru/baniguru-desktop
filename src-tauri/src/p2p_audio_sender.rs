// p2p_audio_sender.rs

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use futures_util::{SinkExt, StreamExt};
use opus::{Application, Bitrate, Channels, Encoder};
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::media::Sample;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;

use crate::audio_bus::AudioBus;

const TARGET_RATE: u32 = 48_000;
const FRAME_MS: usize = 20;
const OPUS_MAX_PACKET_SIZE: usize = 4000;

#[derive(Clone, Debug)]
pub struct ApiConfig {
    pub wss_url: String,
    pub url: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalSdp {
    pub kind: String,
    pub sdp: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IceServer {
    urls: Vec<String>,

    #[serde(default)]
    username: String,

    #[serde(default)]
    credential: String,
}

#[derive(Debug, Clone, Deserialize)]
struct WebRtcConfig {
    #[serde(rename = "iceServers")]
    ice_servers: Vec<IceServer>,

    #[serde(rename = "iceTransportPolicy", default = "default_ice_policy")]
    ice_transport_policy: String,
}

fn default_ice_policy() -> String {
    "all".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SignalMessage {
    #[serde(rename = "ready")]
    Ready,

    #[serde(rename = "webrtc_receiver_ready")]
    ReceiverReady,

    #[serde(rename = "webrtc_offer")]
    Offer { sdp: String },

    #[serde(rename = "webrtc_answer")]
    Answer { sdp: String },

    #[serde(rename = "webrtc_ice_candidate")]
    IceCandidate { candidate: serde_json::Value },

    #[serde(rename = "error")]
    Error { message: String },
}

pub struct P2pAudioSender {
    peer: Arc<RTCPeerConnection>,
    track: Arc<TrackLocalStaticSample>,
}

pub type SharedP2pAudioSender = Arc<Mutex<P2pAudioSender>>;
pub type SharedActiveTrack = Arc<Mutex<Option<Arc<TrackLocalStaticSample>>>>;

async fn fetch_webrtc_config(api_base: &str, token: &str) -> Result<WebRtcConfig> {
    let client = reqwest::Client::new();

    let res = client
        .get(format!("{}/api/turn-credentials", api_base))
        .bearer_auth(token)
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(anyhow!("failed to fetch WebRTC config"));
    }

    Ok(res.json::<WebRtcConfig>().await?)
}

// ==============================
// Public entry point
// WebSocket is used only to exchange SDP.
// Audio is sent only through WebRTC.
// ==============================
pub fn start_p2p_audio_stream_with_signaling(
    _app: AppHandle,
    input_rate: u32,
    channels: u16,
    bus: AudioBus,
    api_config: ApiConfig,
) -> JoinHandle<()> {
    let channel_count = channels as usize;

    tauri::async_runtime::spawn(async move {
        println!("Starting P2P WebRTC audio with reconnectable signaling");

        let active_track: SharedActiveTrack = Arc::new(Mutex::new(None));

        let audio_track_ref = active_track.clone();

        tauri::async_runtime::spawn(async move {
            if let Err(err) = audio_loop(
                bus,
                audio_track_ref,
                input_rate,
                channel_count,
            )
            .await
            {
                eprintln!("P2P audio loop failed: {:?}", err);
            }
        });

        if let Err(e) = run_reconnectable_signaling(
            active_track,
            api_config,
        )
        .await
        {
            eprintln!("WebRTC signaling failed: {:?}", e);
        }
    })
}

async fn make_offer(config: WebRtcConfig) -> Result<(SharedP2pAudioSender, SignalMessage)> {
    let sender = create_p2p_audio_sender(config).await?;
    let offer = create_offer(sender.clone()).await?;

    Ok((
        sender,
        SignalMessage::Offer { sdp: offer.sdp },
    ))
}

// ==============================
// WebSocket signaling only
// ==============================
async fn run_reconnectable_signaling(
    active_track: SharedActiveTrack,
    api_config: ApiConfig,
) -> Result<()> {
    let mut url = Url::parse(&api_config.wss_url)?;

    url.query_pairs_mut()
        .append_pair("token", &api_config.token)
        .append_pair("appid", "gurbani-explorer")
        .append_pair("mode", "webrtc-signaling");

    let (ws, _) = connect_async(url.to_string()).await?;
    let (mut ws_write, mut ws_read) = ws.split();

    println!("Connected to signaling WebSocket");

    let mut pending_sender: Option<SharedP2pAudioSender> = None;
    let mut current_sender: Option<SharedP2pAudioSender> = None;

    let webrtc_config = fetch_webrtc_config(&api_config.url, &api_config.token).await?;
    let (sender, offer_msg) = make_offer(webrtc_config.clone()).await?;
    let mut pending_remote_candidates: Vec<RTCIceCandidateInit> = Vec::new();

    // Send first offer immediately.
    // {
    //     let (sender, offer_msg) = make_offer().await?;
    //     ws_write
    //         .send(Message::Text(serde_json::to_string(&offer_msg)?))
    //         .await?;

    //     pending_sender = Some(sender);

    //     println!("Initial WebRTC offer sent");
    // }

    while let Some(msg) = ws_read.next().await {
        match msg? {
            Message::Text(text) => {
                let signal: SignalMessage = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("Ignoring unknown signaling message: {:?}, text={}", e, text);
                        continue;
                    }
                };

                match signal {
                    SignalMessage::Ready => {
                        println!("Signaling server ready");
                    }

                    SignalMessage::IceCandidate { candidate } => {
                        let candidate: RTCIceCandidateInit = serde_json::from_value(candidate)?;

                        let sender = pending_sender
                            .as_ref()
                            .or(current_sender.as_ref());

                        if let Some(sender) = sender {
                            let locked = sender.lock().await;

                            if locked.peer.remote_description().await.is_some() {
                                locked.peer.add_ice_candidate(candidate).await?;
                                println!("Added remote ICE candidate from browser");
                            } else {
                                pending_remote_candidates.push(candidate);
                                println!("Buffered ICE candidate until answer is set");
                            }
                        } else {
                            pending_remote_candidates.push(candidate);
                            println!("Buffered ICE candidate; no sender yet");
                        }
                    }

                    SignalMessage::ReceiverReady => {
                        println!("Receiver ready/reconnected. Creating new peer.");

                        // Close old connection if any.
                        if let Some(old_sender) = current_sender.take() {
                            let locked = old_sender.lock().await;
                            let _ = locked.peer.close().await;
                        }

                        // Stop writing to old track immediately.
                        *active_track.lock().await = None;

                        let (sender, offer_msg) = make_offer(webrtc_config.clone()).await?;

                        ws_write
                            .send(Message::Text(serde_json::to_string(&offer_msg)?))
                            .await?;

                        pending_sender = Some(sender);

                        println!("Fresh WebRTC offer sent");
                    }

                    SignalMessage::Answer { sdp } => {
                        let sender = match pending_sender.take() {
                            Some(sender) => sender,
                            None => {
                                eprintln!("Received answer but no pending sender");
                                continue;
                            }
                        };

                        accept_answer(
                            sender.clone(),
                            SignalSdp {
                                kind: "answer".to_string(),
                                sdp,
                            },
                        )
                        .await?;

                        {
                            let locked = sender.lock().await;

                            for candidate in pending_remote_candidates.drain(..) {
                                locked.peer.add_ice_candidate(candidate).await?;
                                println!("Added buffered ICE candidate");
                            }
                        }

                        let track = {
                            let locked = sender.lock().await;
                            locked.track.clone()
                        };

                        *active_track.lock().await = Some(track);
                        current_sender = Some(sender);

                        println!("WebRTC answer accepted. Active audio track replaced.");
                    }

                    SignalMessage::Error { message } => {
                        eprintln!("Signaling server error: {}", message);
                    }

                    _ => {}
                }
            }

            Message::Ping(payload) => {
                ws_write.send(Message::Pong(payload)).await?;
            }

            Message::Close(_) => {
                return Err(anyhow!("signaling websocket closed"));
            }

            _ => {}
        }
    }

    Err(anyhow!("signaling ended"))
}

// ==============================
// Create sender peer
// ==============================
pub async fn create_p2p_audio_sender(config: WebRtcConfig) -> Result<SharedP2pAudioSender> {
    let mut media_engine = MediaEngine::default();
    media_engine.register_default_codecs()?;

    let api = APIBuilder::new()
        .with_media_engine(media_engine)
        .build();

    let ice_policy = match config.ice_transport_policy.as_str() {
        "relay" => RTCIceTransportPolicy::Relay,
        "all" => RTCIceTransportPolicy::All,
        _ => RTCIceTransportPolicy::All,
    };

    let config = RTCConfiguration {
        ice_servers: config
            .ice_servers
            .into_iter()
            .map(|s| RTCIceServer {
                urls: s.urls,
                username: s.username,
                credential: s.credential,
                ..Default::default()
            })
            .collect(),

        ice_transport_policy: ice_policy,

        ..Default::default()
    };

    let peer = Arc::new(api.new_peer_connection(config).await?);

    let track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: "audio/opus".to_string(),
            clock_rate: TARGET_RATE,
            channels: 1,
            sdp_fmtp_line: "minptime=10;useinbandfec=1".to_string(),
            rtcp_feedback: vec![],
        },
        "audio".to_string(),
        "rust-tauri-audio".to_string(),
    ));

    peer.add_track(track.clone() as Arc<dyn TrackLocal + Send + Sync>)
        .await?;

    Ok(Arc::new(Mutex::new(P2pAudioSender { peer, track })))
}

// ==============================
// Rust creates offer for JS receiver
// ==============================
pub async fn create_offer(sender: SharedP2pAudioSender) -> Result<SignalSdp> {
    let sender = sender.lock().await;

    let offer = sender.peer.create_offer(None).await?;
    let mut gather_complete = sender.peer.gathering_complete_promise().await;

    sender.peer.set_local_description(offer).await?;

    let _ = gather_complete.recv().await;

    let local = sender
        .peer
        .local_description()
        .await
        .ok_or_else(|| anyhow!("missing local offer"))?;

    Ok(SignalSdp {
        kind: "offer".to_string(),
        sdp: local.sdp,
    })
}

// ==============================
// Rust accepts JS answer
// ==============================
pub async fn accept_answer(
    sender: SharedP2pAudioSender,
    answer_from_js: SignalSdp,
) -> Result<()> {
    let sender = sender.lock().await;

    let answer = RTCSessionDescription::answer(answer_from_js.sdp)?;
    sender.peer.set_remote_description(answer).await?;

    Ok(())
}

// ==============================
// AudioBus → mono → 48kHz → Opus → WebRTC
// No WebSocket audio here.
// ==============================
async fn audio_loop(
    bus: AudioBus,
    active_track: SharedActiveTrack,
    input_rate: u32,
    channel_count: usize,
) -> Result<()> {
    let mut rx = bus.subscribe();

    let input_frame_size = input_rate as usize * FRAME_MS / 1000;
    let input_block = input_frame_size * channel_count;
    let target_frame_size = TARGET_RATE as usize * FRAME_MS / 1000;

    let mut input_buffer: Vec<f32> = Vec::new();
    let mut resampled_buffer: Vec<f32> = Vec::new();

    let mut resampler = if input_rate != TARGET_RATE {
        Some(SincFixedIn::<f32>::new(
            TARGET_RATE as f64 / input_rate as f64,
            2.0,
            SincInterpolationParameters {
                sinc_len: 64,
                f_cutoff: 0.95,
                interpolation: SincInterpolationType::Linear,
                oversampling_factor: 64,
                window: WindowFunction::BlackmanHarris2,
            },
            input_frame_size,
            1,
        )?)
    } else {
        None
    };

    let mut opus_encoder = Encoder::new(
        TARGET_RATE,
        Channels::Mono,
        Application::Voip,
    )?;

    opus_encoder.set_bitrate(Bitrate::Bits(32_000))?;
    opus_encoder.set_inband_fec(true)?;
    opus_encoder.set_packet_loss_perc(5)?;

    let mut opus_packet_buffer = vec![0u8; OPUS_MAX_PACKET_SIZE];

    while let Some(chunk) = rx.recv().await {
        input_buffer.extend_from_slice(&chunk);

        while input_buffer.len() >= input_block {
            let block: Vec<f32> = input_buffer.drain(..input_block).collect();

            let mono: Vec<f32> = block
                .chunks(channel_count)
                .map(|frame| frame.iter().sum::<f32>() / channel_count as f32)
                .collect();

            if let Some(ref mut r) = resampler {
                let output = r.process(&[mono], None)?;
                resampled_buffer.extend_from_slice(&output[0]);
            } else {
                resampled_buffer.extend_from_slice(&mono);
            }
        }

        while resampled_buffer.len() >= target_frame_size {
            let frame: Vec<f32> = resampled_buffer
                .drain(..target_frame_size)
                .collect();

            let pcm_i16 = f32_to_i16_vec(&frame);

            let packet_len = opus_encoder.encode(
                &pcm_i16,
                &mut opus_packet_buffer,
            )?;

            let opus_packet = opus_packet_buffer[..packet_len].to_vec();

            let track = active_track.lock().await.clone();

            if let Some(track) = track {
                if let Err(err) = track
                    .write_sample(&Sample {
                        data: opus_packet.into(),
                        duration: Duration::from_millis(FRAME_MS as u64),
                        ..Default::default()
                    })
                    .await
                {
                    eprintln!("Failed to write WebRTC audio sample: {:?}", err);

                    // Drop dead track. Receiver probably disconnected.
                    *active_track.lock().await = None;
                }
            }
        }
    }

    Ok(())
}

fn f32_to_i16_vec(input: &[f32]) -> Vec<i16> {
    input
        .iter()
        .map(|s| {
            let clamped = s.clamp(-1.0, 1.0);
            (clamped * i16::MAX as f32) as i16
        })
        .collect()
}