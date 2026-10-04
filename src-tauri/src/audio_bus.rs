use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::mpsc;

// The microphone callback publishes 256-frame chunks (~5 ms at 48 kHz).
// Keep a few seconds queued so ONNX inference does not immediately drop audio
// while the single ASR worker is decoding an overlapping window.
const AUDIO_BUS_BUFFER_CHUNKS: usize = 512;
const BLOCKING_AUDIO_BUFFER_CHUNKS: usize = 16;

pub struct BlockingAudioChunk {
    pub sequence: u64,
    pub samples: Vec<f32>,
}

struct BlockingSubscriber {
    sender: crossbeam_channel::Sender<BlockingAudioChunk>,
    receiver: crossbeam_channel::Receiver<BlockingAudioChunk>,
}

#[derive(Clone)]
pub struct AudioBus {
    subscribers: std::sync::Arc<std::sync::Mutex<Vec<mpsc::Sender<Vec<f32>>>>>,
    blocking_subscribers: std::sync::Arc<std::sync::Mutex<Vec<BlockingSubscriber>>>,
    next_sequence: std::sync::Arc<AtomicU64>,
}

impl AudioBus {
    pub fn new() -> Self {
        Self {
            subscribers: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
            blocking_subscribers: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
            next_sequence: std::sync::Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn subscribe(&self) -> mpsc::Receiver<Vec<f32>> {
        let (tx, rx) = mpsc::channel(AUDIO_BUS_BUFFER_CHUNKS);

        self.subscribers.lock().unwrap().push(tx);

        rx
    }

    pub fn subscribe_blocking(&self) -> crossbeam_channel::Receiver<BlockingAudioChunk> {
        let (tx, rx) = crossbeam_channel::bounded(BLOCKING_AUDIO_BUFFER_CHUNKS);
        self.blocking_subscribers
            .lock()
            .unwrap()
            .push(BlockingSubscriber {
                sender: tx,
                receiver: rx.clone(),
            });
        rx
    }

    pub fn publish(&self, data: Vec<f32>) {
        let sequence = self.next_sequence.fetch_add(1, Ordering::Relaxed);
        {
            let mut subs = self.subscribers.lock().unwrap();
            subs.retain(|tx| match tx.try_send(data.clone()) {
                Ok(()) | Err(mpsc::error::TrySendError::Full(_)) => true,
                Err(mpsc::error::TrySendError::Closed(_)) => false,
            });
        }
        {
            let mut subs = self.blocking_subscribers.lock().unwrap();
            subs.retain_mut(|subscriber| {
                let chunk = BlockingAudioChunk {
                    sequence,
                    samples: data.clone(),
                };
                match subscriber.sender.try_send(chunk) {
                    Ok(()) => true,
                    Err(crossbeam_channel::TrySendError::Full(chunk)) => {
                        let _ = subscriber.receiver.try_recv();
                        match subscriber.sender.try_send(chunk) {
                            Ok(()) | Err(crossbeam_channel::TrySendError::Full(_)) => true,
                            Err(crossbeam_channel::TrySendError::Disconnected(_)) => false,
                        }
                    }
                    Err(crossbeam_channel::TrySendError::Disconnected(_)) => false,
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscriber_buffer_retains_audio_during_a_slow_decode() {
        let bus = AudioBus::new();
        let mut receiver = bus.subscribe();

        for index in 0..AUDIO_BUS_BUFFER_CHUNKS {
            bus.publish(vec![index as f32]);
        }

        let mut received = 0;
        while receiver.try_recv().is_ok() {
            received += 1;
        }
        assert_eq!(received, AUDIO_BUS_BUFFER_CHUNKS);
    }
}
