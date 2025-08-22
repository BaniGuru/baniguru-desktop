use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSettings {
    pub theme: String,
    pub font: String,
    pub gurmukhi_font_size: i32,  // Changed Integer to i32
    pub punjabi_font_size: i32,   // Changed Integer to i32
    pub english_font_size: i32,   // Changed Integer to i32
    pub background_color: String,    // Changed Integer to i32
    pub gurmukhi_font_color: String,
    pub punjabi_font_color: String,
    pub english_font_color: String,
    pub background_opacity: f32,
    pub panel_gap_x: i32,
    pub panel_gap_y: i32,
    pub punjabi_gap: i32,         // Changed Integer to i32
    pub english_gap: i32,         // Changed Integer to i32
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            font: "GurbaniAkharThick".into(),
            gurmukhi_font_size: 22,
            punjabi_font_size: 15,
            english_font_size: 15,
            background_color: "rgba(0, 0, 0, 0.8)".into(),
            gurmukhi_font_color: "#ffd532".into(),
            punjabi_font_color: "#FFFFFF".into(),
            english_font_color: "#FFFFFF".into(),
            background_opacity: 0.8,
            panel_gap_x: 4,
            panel_gap_y: 12,
            punjabi_gap: -1,
            english_gap: -5,
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
