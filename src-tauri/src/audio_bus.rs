use tokio::sync::mpsc;

// The microphone callback publishes 256-frame chunks (~5 ms at 48 kHz).
// Keep a few seconds queued so ONNX inference does not immediately drop audio
// while the single ASR worker is decoding an overlapping window.
const AUDIO_BUS_BUFFER_CHUNKS: usize = 512;

#[derive(Clone)]
pub struct AudioBus {
    subscribers: std::sync::Arc<std::sync::Mutex<Vec<mpsc::Sender<Vec<f32>>>>>,
}

impl AudioBus {
    pub fn new() -> Self {
        Self {
            subscribers: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    pub fn subscribe(&self) -> mpsc::Receiver<Vec<f32>> {
        let (tx, rx) = mpsc::channel(AUDIO_BUS_BUFFER_CHUNKS);

        self.subscribers.lock().unwrap().push(tx);

        rx
    }

    pub fn publish(&self, data: Vec<f32>) {
        let subs = self.subscribers.lock().unwrap();

        for tx in subs.iter() {
            let _ = tx.try_send(data.clone());
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
