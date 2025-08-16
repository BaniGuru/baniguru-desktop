use warp::Filter;
use crate::commands::Pankti;
use tera::{Tera, Context};
use tauri::{AppHandle, Manager};
use std::sync::Arc;
use tokio::sync::Mutex;

pub async fn start_web_server(app_handle: AppHandle) {
    let tera = Tera::new("templates/**/*")
        .expect("Could not initialize Tera templates.");
    let tera = Arc::new(tera);

    let app_handle_clone = app_handle.clone();
    let tera_clone = tera.clone();

    let routes = warp::path!("custom_page").and_then(move || {
        let app_handle = app_handle_clone.clone();
        let tera = tera_clone.clone();

        async move {
            let html = render_custom_page(app_handle, tera).await;
            Ok::<_, std::convert::Infallible>(warp::reply::html(html))
        }
    });

    warp::serve(routes)
        .run(([127, 0, 0, 1], 8080))
        .await;
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
