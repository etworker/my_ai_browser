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

#[derive(Debug, Serialize, Deserialize)]
pub struct BrowserPageInfo {
    pub title: String,
    pub url: String,
    pub screenshot: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DOMInfo {
    pub title: String,
    pub url: String,
    pub interactive_elements: Vec<InteractiveElement>,
    pub full_dom: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InteractiveElement {
    pub tag: String,
    pub text: String,
    pub rect: ScreenRegion,
    pub selector: String,
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
async fn browser_capture(app: AppHandle, image_data: String, url: String) -> Result<(), String> {
    app.emit("browser-capture", serde_json::json!({
        "screenshot": image_data,
        "url": url
    }))
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn browser_dom(app: AppHandle, dom_data: String, url: String) -> Result<(), String> {
    let dom_info: DOMInfo = serde_json::from_str(&dom_data)
        .map_err(|e| e.to_string())?;
    
    app.emit("browser-dom", serde_json::json!({
        "dom": dom_info,
        "url": url
    }))
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_browser_window(app: AppHandle) -> Result<(), String> {
    if let Some(browser) = app.get_webview_window("browser") {
        browser.show().map_err(|e| e.to_string())?;
        browser.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    
    WebviewWindowBuilder::new(&app, "browser", WebviewUrl::App("/browser.html".into()))
        .title("VOA Browser")
        .inner_size(1024.0, 768.0)
        .min_inner_size(800.0, 600.0)
        .center()
        .resizable(true)
        .decorations(true)
        .build()
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn close_browser_window(app: AppHandle) -> Result<(), String> {
    if let Some(browser) = app.get_webview_window("browser") {
        browser.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn highlight_element(
    app: AppHandle,
    selector: String,
    hint: String,
) -> Result<(), String> {
    if let Some(browser) = app.get_webview_window("browser") {
        browser.emit("highlight-element", serde_json::json!({
            "selector": selector,
            "hint": hint
        }))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn click_element(
    app: AppHandle,
    selector: String,
) -> Result<(), String> {
    if let Some(browser) = app.get_webview_window("browser") {
        browser.emit("click-element", serde_json::json!({
            "selector": selector
        }))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn create_overlay_window(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.show().map_err(|e| e.to_string())?;
        overlay.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_overlay_window(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e| e.to_string())?;
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
        .setup(|app| {
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.hide();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            browser_capture,
            browser_dom,
            open_browser_window,
            close_browser_window,
            highlight_element,
            click_element,
            create_overlay_window,
            close_overlay_window,
            show_highlight,
            hide_highlight,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
