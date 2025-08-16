use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSettings {
    pub theme: String,
    pub font: String,
    pub font_size: Option<String>,        // e.g. "16px", "20px"
    pub background_color: Option<String>, // e.g. "#ffffff"
    pub background_opacity: Option<f32>,  // 0.0 to 1.0
    pub font_gap: Option<String>,          // e.g. "10px"
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            font: "GurbaniAkharThick".into(),
            font_size: Some("16px".into()),
            background_color: Some("#ffffff".into()),
            background_opacity: Some(0.1),
            font_gap: Some("10px".into()),
        }
    }
}

pub fn load_settings(path: &PathBuf) -> UserSettings {
    if path.exists() {
        let data = fs::read_to_string(path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        UserSettings::default()
    }
}

pub fn save_settings(path: &PathBuf, settings: &UserSettings) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(settings).unwrap();
    fs::write(path, json).unwrap();
}
