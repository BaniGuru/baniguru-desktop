use tokio::sync::mpsc;

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
        let (tx, rx) = mpsc::channel(32);

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