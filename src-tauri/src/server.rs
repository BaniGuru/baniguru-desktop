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
            context.insert("title", "Settings");
            context.insert("theme", &settings.theme);
            context.insert("font", &settings.font);
            context.insert("font_size", &settings.font_size.clone().unwrap_or("16px".to_string()));
            context.insert("background_color", &settings.background_color.clone().unwrap_or("#ffffff".to_string()));
            context.insert("background_opacity", &settings.background_opacity.unwrap_or(1.0));
            context.insert("font_gap", &settings.font_gap.clone().unwrap_or("10px".to_string()));

            let html = tera.render("settings.html", &context).unwrap();
            Ok::<_, std::convert::Infallible>(warp::reply::html(html))
        }
    });


    // Save settings from form
    let save_settings_route = warp::path("save_settings")
        .and(warp::post())
        .and(warp::body::form())
        .map(move |form: HashMap<String, String>| {
            let settings = UserSettings {
                theme: form.get("theme").cloned().unwrap_or_default(),
                font: form.get("font").cloned().unwrap_or_default(),
                font_size: form.get("font_size").cloned(),
                background_color: form.get("background_color").cloned(),
                background_opacity: form.get("background_opacity")
                    .and_then(|v| v.parse::<f32>().ok()),
                font_gap: form.get("font_gap").cloned(),
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
            // get Pankti and settings
            let state = app_handle.state::<Mutex<Pankti>>();
            let locked = state.lock().await;

            let path = app_handle.state::<PathBuf>();
            let settings = load_settings(&path);

            let (r, g, b) = hex_to_rgb(settings.background_color.as_deref().unwrap_or("#ffffff"));

            let data = json!({
                "gurmukhi": locked.gurmukhi,
                "punjabi": locked.punjabi,
                "english": locked.english,
                "theme": settings.theme,
                "font": settings.font,
                "font_size": settings.font_size.clone().unwrap_or_else(|| "16px".to_string()),
                "background_color_rgb": {
                    "r": r,
                    "g": g,
                    "b": b
                },
                "background_opacity": settings.background_opacity.unwrap_or(1.0),
                "font_gap": settings.font_gap.clone().unwrap_or_else(|| "10px".to_string()),
            });


            Ok::<Json, warp::Rejection>(warp::reply::json(&data))
        }
    });

    let custom_page = warp::path!("custom_page").and_then(move || {
        let app_handle = app_handle_clone.clone();
        let tera = tera_clone.clone();

        async move {
            let html = render_custom_page_with_settings(app_handle, tera).await;
            Ok::<_, std::convert::Infallible>(warp::reply::html(html))
        }
    });

    let routes = custom_page
        .or(settings_page)
        .or(save_settings_route)
        .or(api_custom_data)
        .or(static_files);

    warp::serve(routes)
        .run(([127, 0, 0, 1], 8080))
        .await;
}

async fn render_custom_page_with_settings(
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

    let (r, g, b) = hex_to_rgb(settings.background_color.as_deref().unwrap_or("#ffffff"));

    let mut context = Context::new();
    context.insert("title", "Gurbani");
    context.insert("gurmukhi", &pankti.gurmukhi);
    context.insert("punjabi", &pankti.punjabi);
    context.insert("english", &pankti.english);
    context.insert("theme", &settings.theme);
    context.insert("font", &settings.font);
    context.insert("font_size", &settings.font_size.clone().unwrap_or("16px".to_string()));
    context.insert("background_color", &settings.background_color.clone().unwrap_or("#ffffff".to_string()));
    context.insert("background_opacity", &settings.background_opacity.unwrap_or(1.0));
    context.insert("background_color_rgb", &serde_json::json!({ "r": r, "g": g, "b": b }));
    context.insert("font_gap", &settings.font_gap.clone().unwrap_or("10px".to_string()));

    tera.render("message.html", &context)
        .unwrap_or_else(|e| {
            eprintln!("Template error: {}", e);
            "Error rendering page.".to_string()
        })
}

// 🔄 Now renders the page *and* accesses the shared state inside
async fn render_custom_page(app_handle: AppHandle, tera: Arc<Tera>) -> String {
    // Access and lock the shared state
    let state = app_handle.state::<Mutex<Pankti>>();
    let locked_state = state.lock().await;

    // Clone the state contents
    let pankti = Pankti {
        gurmukhi: locked_state.gurmukhi.clone(),
        punjabi: locked_state.punjabi.clone(),
        english: locked_state.english.clone(),
    };

    // Build context for the template
    let mut context = Context::new();
    context.insert("title", "Gurbani");
    context.insert("gurmukhi", &pankti.gurmukhi);
    context.insert("punjabi", &pankti.punjabi);
    context.insert("english", &pankti.english);

    tera.render("message.html", &context)
        .unwrap_or_else(|e| {
            eprintln!("Template error: {}", e);
            "Error rendering page.".to_string()
        })
}
