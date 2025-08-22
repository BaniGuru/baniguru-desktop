// src/commands.rs

use serde::{Serialize, Deserialize};
use tauri::State;
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pankti {
    pub gurmukhi: String,
    pub punjabi: String,
    pub english: String,
}

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
