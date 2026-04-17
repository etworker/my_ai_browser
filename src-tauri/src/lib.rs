use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Serialize, Deserialize)]
pub struct ScreenRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CaptureResult {
    pub image_base64: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
fn capture_screen() -> Result<CaptureResult, String> {
    let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
    
    if screens.is_empty() {
        return Err("No screens found".to_string());
    }
    
    let screen = &screens[0];
    let capture = screen.capture().map_err(|e| e.to_string())?;
    
    let width = capture.width();
    let height = capture.height();
    
    let mut buf = Cursor::new(Vec::new());
    capture
        .write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)
        .map_err(|e| e.to_string())?;
    
    let image_base64 = STANDARD.encode(buf.into_inner());
    
    Ok(CaptureResult {
        image_base64,
        width,
        height,
    })
}

#[tauri::command]
async fn create_overlay_window(app: AppHandle) -> Result<(), String> {
    let overlay = app.get_webview_window("overlay");
    
    if overlay.is_some() {
        return Ok(());
    }
    
    WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("/overlay.html".into()))
        .title("VOA Overlay")
        .fullscreen(true)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .decorations(false)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn close_overlay_window(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn show_highlight(
    app: AppHandle,
    region: ScreenRegion,
    hint: String,
) -> Result<(), String> {
    app.emit("show-highlight", serde_json::json!({
        "region": region,
        "hint": hint
    }))
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_highlight(app: AppHandle) -> Result<(), String> {
    app.emit("hide-highlight", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            create_overlay_window,
            close_overlay_window,
            show_highlight,
            hide_highlight,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
