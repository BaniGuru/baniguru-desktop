// src/commands.rs

use serde::{Serialize, Deserialize};
use tauri::State;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pankti {
    pub gurmukhi: String,
    pub punjabi: String,
    pub english: String,
}

#[tauri::command]
pub fn update_pankti(
    pankti: Pankti,
    state: State<'_, Mutex<Pankti>>
) -> Result<Pankti, String> {
    let mut panktiState = state.lock().unwrap();
    panktiState.gurmukhi = pankti.gurmukhi.clone();
    panktiState.punjabi = pankti.punjabi.clone();
    panktiState.english = pankti.english.clone();

    // Optionally persist the data here

    Ok(pankti.clone())
}
