use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::{AppHandle, Emitter, Manager};

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
pub struct PageData {
    pub title: String,
    pub url: String,
    pub elements: Vec<PageElement>,
    pub html: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PageElement {
    pub tag: String,
    pub text: String,
    pub rect: ScreenRegion,
    pub selector: String,
    pub href: Option<String>,
    #[serde(rename = "type")]
    pub input_type: Option<String>,
    pub placeholder: Option<String>,
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
async fn analyze_page(app: AppHandle, page_data: String) -> Result<(), String> {
    let data: PageData = serde_json::from_str(&page_data)
        .map_err(|e| e.to_string())?;
    
    app.emit("page-analyzed", serde_json::json!({
        "page": data
    }))
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_auto_mode(app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.emit("set_auto_mode", serde_json::json!({
            "enabled": enabled
        }))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn navigate_browser(app: AppHandle, url: String) -> Result<(), String> {
    let main_window = app.get_webview_window("main").ok_or("Main window not found")?;
    
    main_window.emit("browser-navigate", serde_json::json!({ "url": url }))
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn create_browser_webview(app: AppHandle, url: String) -> Result<(), String> {
    let main_window = app.get_webview_window("main").ok_or("Main window not found")?;
    
    main_window.emit("create-webview", serde_json::json!({ "url": url }))
        .map_err(|e| e.to_string())?;
    
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

#[tauri::command]
async fn execute_browser_action(app: AppHandle, action: String) -> Result<(), String> {
    let action_data: serde_json::Value = serde_json::from_str(&action)
        .map_err(|e| e.to_string())?;
    
    let action_type = action_data["type"].as_str().unwrap_or("");
    
    if action_type == "click" {
        if let Some(selector) = action_data["selector"].as_str() {
            if let Some(main) = app.get_webview_window("main") {
                main.emit("click_action", serde_json::json!({ "selector": selector }))
                    .map_err(|e| e.to_string())?;
            }
        }
    } else if action_type == "navigate" {
        if let Some(url) = action_data["url"].as_str() {
            if let Some(main) = app.get_webview_window("main") {
                main.emit("navigate_action", serde_json::json!({ "url": url }))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    
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
            analyze_page,
            set_auto_mode,
            navigate_browser,
            create_browser_webview,
            show_highlight,
            hide_highlight,
            execute_browser_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
