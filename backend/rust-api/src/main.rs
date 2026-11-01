
use axum::{
    body::Body,
    extract::{Multipart, Path as AxumPath, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json,
    Router,
};

use std::collections::HashMap;
use std::path::Path;
use tokio::fs;
use tokio::net::TcpListener;

use image::GenericImageView;
use serde_json::{json, Value};
use reqwest::multipart::{Form, Part};
use tower_http::cors::CorsLayer;


// ==========================================
// PYTHON BACKEND CONFIGURATION
// ==========================================

fn python_api_url(endpoint: &str) -> String {
    let base_url = std::env::var("PYTHON_API_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8000".to_string());

    format!("{}{}", base_url.trim_end_matches('/'), endpoint)
}


// ==========================================
// BASIC ROUTES
// ==========================================

async fn home() -> Json<Value> {
    Json(json!({
        "name": "ZeameBG API",
        "status": "running"
    }))
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "healthy",
        "service": "rust-api"
    }))
}


// ==========================================
// UPLOAD IMAGE
// ==========================================

async fn upload_image(
    mut multipart: Multipart,
) -> Result<Json<Value>, (StatusCode, String)> {

    while let Some(field) = multipart.next_field().await
        .map_err(|_| (
            StatusCode::BAD_REQUEST,
            "Invalid upload".to_string()
        ))?
    {
        let filename = field.file_name()
            .unwrap_or("image")
            .to_string();

        let bytes = field.bytes().await
            .map_err(|_| (
                StatusCode::BAD_REQUEST,
                "Could not read file".to_string()
            ))?;

        if bytes.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                "Uploaded file is empty".to_string()
            ));
        }

        if bytes.len() > 10 * 1024 * 1024 {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "Image exceeds the 10MB limit".to_string()
            ));
        }

        let format = image::guess_format(&bytes)
            .map_err(|_| (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Invalid image format".to_string()
            ))?;

        let decoded = image::load_from_memory(&bytes)
            .map_err(|_| (
                StatusCode::BAD_REQUEST,
                "Could not decode image".to_string()
            ))?;

        let dimensions = decoded.dimensions();

        if dimensions.0 as u64 * dimensions.1 as u64 > 25_000_000 {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "Image dimensions are too large".to_string()
            ));
        }

        let extension = match format {
            image::ImageFormat::Jpeg => "jpg",
            image::ImageFormat::Png => "png",
            image::ImageFormat::WebP => "webp",
            _ => {
                return Err((
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "Only JPG, PNG and WebP images are supported".to_string()
                ));
            }
        };

        fs::create_dir_all("uploads")
            .await
            .map_err(|_| (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not create upload folder".to_string()
            ))?;

        let unique_name = format!(
            "image_{}.{}",
            uuid::Uuid::new_v4(),
            extension
        );

        let save_path = Path::new("uploads").join(&unique_name);

        fs::write(&save_path, &bytes)
            .await
            .map_err(|_| (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not save image".to_string()
            ))?;

        return Ok(Json(json!({
            "message": "Image uploaded and saved successfully",
            "original_filename": filename,
            "saved_filename": unique_name,
            "format": format!("{:?}", format),
            "size_bytes": bytes.len(),
            "width": dimensions.0,
            "height": dimensions.1,
            "storage": "temporary"
        })));
    }

    Err((
        StatusCode::BAD_REQUEST,
        "No image was uploaded".to_string()
    ))
}


// ==========================================
// GET SAVED IMAGE
// ==========================================

async fn get_image(
    AxumPath(filename): AxumPath<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {

    let Some((id, extension)) = filename
        .strip_prefix("image_")
        .and_then(|name| name.split_once('.'))
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid image filename".to_string()
        ));
    };

    uuid::Uuid::parse_str(id)
        .map_err(|_| (
            StatusCode::BAD_REQUEST,
            "Invalid image ID".to_string()
        ))?;

    let content_type = match extension {
        "jpg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => {
            return Err((
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Unsupported image format".to_string()
            ));
        }
    };

    let file_path = Path::new("uploads").join(&filename);

    let bytes = fs::read(file_path)
        .await
        .map_err(|_| (
            StatusCode::NOT_FOUND,
            "Image not found".to_string()
        ))?;

    Ok((
        [(header::CONTENT_TYPE, content_type)],
        bytes
    ))
}


// ==========================================
// GENERIC PYTHON RESPONSE FORWARDER
// ==========================================

async fn forward_python_response(
    response: reqwest::Response,
) -> Result<Response, (StatusCode, String)> {

    let status = StatusCode::from_u16(
        response.status().as_u16()
    ).unwrap_or(StatusCode::BAD_GATEWAY);

    let content_type = response.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();

    let bytes = response.bytes().await
        .map_err(|_| (
            StatusCode::BAD_GATEWAY,
            "Could not receive response from Python".to_string()
        ))?;

    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(bytes))
        .map_err(|_| (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not build response".to_string()
        ))
}


// ==========================================
// GENERIC MULTIPART PYTHON PROXY
// ==========================================

async fn forward_python_multipart(
    endpoint: &str,
    mut multipart: Multipart,
) -> Result<Response, (StatusCode, String)> {

    let mut form = Form::new();

    while let Some(field) = multipart.next_field().await
        .map_err(|_| (
            StatusCode::BAD_REQUEST,
            "Invalid multipart upload".to_string()
        ))?
    {
        let name = field.name()
            .unwrap_or("")
            .to_string();

        let filename = field.file_name()
            .map(|value| value.to_string());

        let content_type = field.content_type()
            .map(|value| value.to_string());

        let bytes = field.bytes().await
            .map_err(|_| (
                StatusCode::BAD_REQUEST,
                "Could not read multipart field".to_string()
            ))?;

        if let Some(filename) = filename {
            if bytes.len() > 10 * 1024 * 1024 {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Uploaded file exceeds the 10MB limit".to_string()
                ));
            }

            let mut part = Part::bytes(bytes.to_vec())
                .file_name(filename);

            if let Some(content_type) = content_type {
                part = part.mime_str(&content_type)
                    .map_err(|_| (
                        StatusCode::BAD_REQUEST,
                        "Invalid file content type".to_string()
                    ))?;
            }

            form = form.part(name, part);

        } else {
            let value = String::from_utf8(bytes.to_vec())
                .map_err(|_| (
                    StatusCode::BAD_REQUEST,
                    "Invalid text field".to_string()
                ))?;

            form = form.text(name, value);
        }
    }

    let response = reqwest::Client::new()
        .post(python_api_url(endpoint))
        .multipart(form)
        .send()
        .await
        .map_err(|_| (
            StatusCode::BAD_GATEWAY,
            "Could not connect to Python AI backend".to_string()
        ))?;

    forward_python_response(response).await
}


// ==========================================
// IMAGE PROCESSING PROXIES
// ==========================================

async fn remove_bg_proxy(
    multipart: Multipart,
) -> Result<Response, (StatusCode, String)> {

    forward_python_multipart("/remove-bg", multipart).await
}

async fn replace_color_proxy(
    multipart: Multipart,
) -> Result<Response, (StatusCode, String)> {

    forward_python_multipart("/replace-color", multipart).await
}

async fn replace_bg_proxy(
    multipart: Multipart,
) -> Result<Response, (StatusCode, String)> {

    forward_python_multipart("/replace-bg", multipart).await
}

async fn to_3d_proxy(
    multipart: Multipart,
) -> Result<Response, (StatusCode, String)> {

    forward_python_multipart("/to-3d", multipart).await
}


// ==========================================
// UNSPLASH SEARCH PROXY
// ==========================================

async fn unsplash_search_proxy(
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, (StatusCode, String)> {

    let response = reqwest::Client::new()
        .get(python_api_url("/unsplash/search"))
        .query(&params)
        .send()
        .await
        .map_err(|_| (
            StatusCode::BAD_GATEWAY,
            "Could not connect to Python Unsplash service".to_string()
        ))?;

    forward_python_response(response).await
}


// ==========================================
// UNSPLASH IMAGE PROXY
// ==========================================

async fn unsplash_image_proxy(
    AxumPath(photo_id): AxumPath<String>,
) -> Result<Response, (StatusCode, String)> {

    let response = reqwest::Client::new()
        .get(python_api_url(
            &format!("/unsplash/image/{}", photo_id)
        ))
        .send()
        .await
        .map_err(|_| (
            StatusCode::BAD_GATEWAY,
            "Could not retrieve Unsplash image".to_string()
        ))?;

    forward_python_response(response).await
}


// ==========================================
// UNSPLASH DOWNLOAD TRACKING PROXY
// ==========================================

async fn unsplash_download_proxy(
    Json(payload): Json<Value>,
) -> Result<Response, (StatusCode, String)> {

    let response = reqwest::Client::new()
        .post(python_api_url("/unsplash/track-download"))
        .json(&payload)
        .send()
        .await
        .map_err(|_| (
            StatusCode::BAD_GATEWAY,
            "Could not connect to Unsplash tracking service".to_string()
        ))?;

    forward_python_response(response).await
}


// ==========================================
// MAIN SERVER
// ==========================================

#[tokio::main]
async fn main() {

    let app = Router::new()
        .route("/", get(home))
        .route("/health", get(health))

        // Image storage
        .route("/upload", post(upload_image))
        .route("/images/{filename}", get(get_image))

        // Image processing
        .route("/remove-bg", post(remove_bg_proxy))
        .route("/replace-color", post(replace_color_proxy))
        .route("/replace-bg", post(replace_bg_proxy))
        .route("/to-3d", post(to_3d_proxy))

        // Unsplash
        .route("/unsplash/search", get(unsplash_search_proxy))
        .route("/unsplash/image/{photo_id}", get(unsplash_image_proxy))
        .route("/unsplash/track-download", post(unsplash_download_proxy))

        .layer(CorsLayer::permissive());

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8001".to_string());

    let address = format!("0.0.0.0:{}", port);

    let listener = TcpListener::bind(&address)
        .await
        .expect("Could not start Rust API server");

    println!("ZeameBG Rust API running on {}", address);

    axum::serve(listener, app)
        .await
        .unwrap();
}
