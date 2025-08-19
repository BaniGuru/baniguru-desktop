use warp::Filter;
use crate::commands::Pankti;
use tera::{Tera, Context};
use tauri::{AppHandle, Manager};
use std::sync::Arc;
use std::path::PathBuf;
use tokio::sync::Mutex;
use std::collections::HashMap;
use warp::http;
use crate::settings::{load_settings, save_settings, UserSettings};
use warp::reply::Json;
use serde_json::json;

fn hex_to_rgb(hex: &str) -> (u8, u8, u8) {
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255);
    (r, g, b)
}

pub async fn start_web_server(app_handle: AppHandle) {
    let tera = Tera::new("templates/**/*")
        .expect("Could not initialize Tera templates.");
    let tera = Arc::new(tera);

    let app_handle_clone = app_handle.clone();
    let app_handle_clone_for_save = app_handle.clone();
    let app_handle_clone_for_api = app_handle.clone();
    let app_handle_clone_for_settings = app_handle.clone();
    let tera_clone = tera.clone();

    let static_files = warp::path("static").and(warp::fs::dir("static"));

    // Render settings page
    let settings_page = warp::path("settings").and_then(move || {
        let tera = tera.clone();
        let app_handle = app_handle_clone_for_settings.clone();
        async move {
            let path = app_handle.state::<PathBuf>();
            let settings = load_settings(&path);

            let mut context = Context::new();
            let rounded_opacity = (settings.background_opacity * 10.0).round() / 10.0;
            let rounded_opacity_str = format!("{:.1}", rounded_opacity);
            context.insert("title", "Settings");
            context.insert("theme", &settings.theme);
            context.insert("font", &settings.font);
            context.insert("gurmukhi_font_size", &settings.gurmukhi_font_size);  // Removed unwrap_or
            context.insert("punjabi_font_size", &settings.punjabi_font_size);    // Removed unwrap_or
            context.insert("english_font_size", &settings.english_font_size);    // Removed unwrap_or
            context.insert("background_color", &settings.background_color.to_string()); // Converted integer to string
            context.insert("gurmukhi_font_color", &settings.gurmukhi_font_color.to_string()); // Converted integer to string
            context.insert("punjabi_font_color", &settings.punjabi_font_color.to_string()); // Converted integer to string
            context.insert("english_font_color", &settings.english_font_color.to_string()); // Converted integer to string
            context.insert("background_opacity", &rounded_opacity_str);
            context.insert("panel_gap_x", &settings.panel_gap_x);
            context.insert("panel_gap_y", &settings.panel_gap_y);
            context.insert("punjabi_gap", &settings.punjabi_gap);  // No unwrap needed
            context.insert("english_gap", &settings.english_gap);  // No unwrap needed

            let html = tera.render("settings.html", &context).unwrap();
            Ok::<_, std::convert::Infallible>(warp::reply::html(html))
        }
    });


    let save_settings_route = warp::path("save_settings")
        .and(warp::post())
        .and(warp::body::form())
        .map(move |form: HashMap<String, String>| {
            let settings = UserSettings {
                theme: form.get("theme").cloned().unwrap_or_default(),
                font: form.get("font").cloned().unwrap_or_default(),
                gurmukhi_font_size: form.get("gurmukhi_font_size")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(16), // Default to 16 if not provided
                punjabi_font_size: form.get("punjabi_font_size")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(16), // Default to 16 if not provided
                english_font_size: form.get("english_font_size")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(16), // Default to 16 if not provided
                background_color: form.get("background_color").cloned()
                    .unwrap_or_default(), // Default to white color
                gurmukhi_font_color: form.get("gurmukhi_font_color").cloned()
                    .unwrap_or_default(), // Default to white color
                punjabi_font_color: form.get("punjabi_font_color").cloned()
                    .unwrap_or_default(), // Default to white color
                english_font_color: form.get("english_font_color").cloned()
                    .unwrap_or_default(), // Default to white color
                background_opacity: form.get("background_opacity")
                    .and_then(|v| v.parse::<f32>().ok())
                    .unwrap_or(1.0), // Default to 1.0 if not provided
                panel_gap_x: form.get("panel_gap_x")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(2),
                panel_gap_y: form.get("panel_gap_y")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(2),
                punjabi_gap: form.get("punjabi_gap")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(2), // Default to 2 if not provided
                english_gap: form.get("english_gap")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(2), // Default to 2 if not provided
            };
            let path = app_handle_clone_for_save.state::<PathBuf>();
            save_settings(&path, &settings);
            warp::redirect::see_other("/settings".parse::<http::Uri>().unwrap())
        });
    
    let api_custom_data = warp::path("api")
    .and(warp::path("custom_data"))
    .and_then(move || {
        let app_handle = app_handle_clone_for_api.clone();
        async move {
            // Get Pankti and settings
            let state = app_handle.state::<Mutex<Pankti>>();
            let locked = state.lock().await;

            let path = app_handle.state::<PathBuf>();
            let settings = load_settings(&path);

            let data = json!({
                "gurmukhi": remove_vishraams(&locked.gurmukhi),
                "punjabi": locked.punjabi,
                "english": locked.english,
                "theme": settings.theme,
                "font": settings.font,
                "gurmukhi_font_size": settings.gurmukhi_font_size,  // Removed clone and unwrap_or_default
                "punjabi_font_size": settings.punjabi_font_size,    // Removed clone and unwrap_or_default
                "english_font_size": settings.english_font_size,    // Removed clone and unwrap_or_default
                "background_color": settings.background_color,
                "gurmukhi_font_color": settings.gurmukhi_font_color,
                "punjabi_font_color": settings.punjabi_font_color,
                "english_font_color": settings.english_font_color,
                "background_opacity": settings.background_opacity,  // No unwrap_or needed
                "panel_gap_x": settings.panel_gap_x,
                "panel_gap_y": settings.panel_gap_y,
                "punjabi_gap": settings.punjabi_gap,  // No unwrap_or needed
                "english_gap": settings.english_gap,  // No unwrap_or needed
            });

            Ok::<Json, warp::Rejection>(warp::reply::json(&data))
        }
    });

    let overlay_page = warp::path!("overlay").and_then(move || {
        let app_handle = app_handle_clone.clone();
        let tera = tera_clone.clone();

        async move {
            let html = render_overlay_page(app_handle, tera).await;
            Ok::<_, std::convert::Infallible>(warp::reply::html(html))
        }
    });

    let routes = overlay_page
        .or(settings_page)
        .or(save_settings_route)
        .or(api_custom_data)
        .or(static_files);

    warp::serve(routes)
        .run(([0, 0, 0, 0], 54321))
        .await;
}

fn remove_vishraams(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }

    text.replace(&[';', '.', ','][..], "")
}

async fn render_overlay_page(
    app_handle: AppHandle,
    tera: Arc<Tera>,
) -> String {
    let state = app_handle.state::<tokio::sync::Mutex<Pankti>>();
    let pankti = {
        let locked = state.lock().await;
        locked.clone()
    };

    let path = app_handle.state::<PathBuf>();
    let settings = load_settings(&path);

    let (r, g, b) = hex_to_rgb(settings.background_color.to_string().as_str());

    let mut context = Context::new();
    context.insert("title", "Gurbani");
    context.insert("gurmukhi", &remove_vishraams(&pankti.gurmukhi));
    context.insert("punjabi", &pankti.punjabi);
    context.insert("english", &pankti.english);
    context.insert("theme", &settings.theme);
    context.insert("font", &settings.font);
    context.insert("font_size", &settings.gurmukhi_font_size.to_string());  // Removed clone and unwrap_or
    context.insert("background_color", &settings.background_color.to_string());  // Converted to string
    context.insert("gurmukhi_font_color", &settings.gurmukhi_font_color.to_string()); // Converted integer to string
    context.insert("punjabi_font_color", &settings.punjabi_font_color.to_string()); // Converted integer to string
    context.insert("english_font_color", &settings.english_font_color.to_string()); // Converted integer to string
    context.insert("background_opacity", &settings.background_opacity);  // No unwrap needed
    context.insert("panel_gap_x", &settings.panel_gap_x.to_string());
    context.insert("panel_gap_y", &settings.panel_gap_y.to_string());

    tera.render("overlay.html", &context)
        .unwrap_or_else(|e| {
            eprintln!("Template error: {}", e);
            "Error rendering page.".to_string()
        })
}
