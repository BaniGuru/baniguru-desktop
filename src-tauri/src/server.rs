// src/server.rs
use std::net::SocketAddr;
use warp::Filter;
use tera::{Tera, Context};

pub async fn start_web_server() {
    // Initialize Tera and load templates
    let tera = Tera::new("templates/**/*").expect("Failed to initialize Tera");

    // Clone tera into the warp filter
    let tera_filter = warp::any().map(move || tera.clone());

    // Route: /
    let index_route = warp::path::end()
        .and(tera_filter.clone())
        .and_then(render_custom_page);

    // Combine the route(s)
    let routes = index_route;

    let addr: SocketAddr = ([127, 0, 0, 1], 8080).into();
    println!("🚀 Server running at http://{}", addr);

    warp::serve(routes).run(addr).await;
}

async fn render_custom_page(tera: Tera) -> Result<impl warp::Reply, warp::Rejection> {
    let mut context = Context::new();
    context.insert("title", "Tera + Warp Example");
    context.insert("message", "Hello from Tera Template!");

    match tera.render("message.html", &context) {
        Ok(rendered) => Ok(warp::reply::html(rendered)),
        Err(e) => {
            eprintln!("Template error: {}", e);
            Err(warp::reject::reject())
        }
    }
}
