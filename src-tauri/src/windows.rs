use std::{collections::HashMap, sync::Mutex};

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
pub struct WindowWorkspaceState(pub Mutex<HashMap<String, String>>);

fn label_for(id: &str) -> String {
    let safe = id
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() {
                value
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!("workspace-{safe}")
}

fn registered_workspace_window(
    app: &AppHandle,
    workspace_id: &str,
    state: &WindowWorkspaceState,
) -> Result<Option<WebviewWindow>, String> {
    let label = state
        .0
        .lock()
        .map_err(|_| "Window registry lock poisoned".to_string())?
        .get(workspace_id)
        .cloned();
    let Some(label) = label else { return Ok(None) };
    if let Some(window) = app.get_webview_window(&label) {
        return Ok(Some(window));
    }
    state
        .0
        .lock()
        .map_err(|_| "Window registry lock poisoned".to_string())?
        .remove(workspace_id);
    Ok(None)
}

fn focus_workspace_window(
    app: &AppHandle,
    workspace_id: &str,
    workspace_name: &str,
    state: &WindowWorkspaceState,
) -> Result<WebviewWindow, String> {
    let window = if let Some(window) = registered_workspace_window(app, workspace_id, state)? {
        window
    } else {
        let label = label_for(workspace_id);
        let window = if let Some(window) = app.get_webview_window(&label) {
            window
        } else {
            let url = WebviewUrl::App(format!("index.html?workspaceId={workspace_id}").into());
            WebviewWindowBuilder::new(app, &label, url)
                .title(format!("TesAPI — {workspace_name}"))
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .build()
                .map_err(|error| error.to_string())?
        };
        state
            .0
            .lock()
            .map_err(|_| "Window registry lock poisoned".to_string())?
            .insert(workspace_id.to_owned(), label);
        window
    };
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window)
}

#[tauri::command]
pub fn register_workspace_window(
    window: WebviewWindow,
    workspace_id: String,
    state: State<'_, WindowWorkspaceState>,
) -> Result<(), String> {
    let mut windows = state
        .0
        .lock()
        .map_err(|_| "Window registry lock poisoned".to_string())?;
    windows.retain(|_, label| label != window.label());
    windows.insert(workspace_id, window.label().to_owned());
    Ok(())
}

#[tauri::command]
pub fn set_workspace_window_title(
    window: WebviewWindow,
    workspace_name: String,
) -> Result<(), String> {
    window
        .set_title(&format!("TesAPI — {workspace_name}"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_workspace_window(
    app: AppHandle,
    workspace_id: String,
    workspace_name: String,
    state: State<'_, WindowWorkspaceState>,
) -> Result<(), String> {
    focus_workspace_window(&app, &workspace_id, &workspace_name, &state)?;
    Ok(())
}

pub fn present_mcp_approval(
    app: &AppHandle,
    workspace_id: &str,
    workspace_name: &str,
) -> Result<(), String> {
    let state = app.state::<WindowWorkspaceState>();
    let window = focus_workspace_window(app, workspace_id, workspace_name, &state)?;
    window
        .set_minimizable(false)
        .map_err(|error| error.to_string())?;
    if let Err(error) = window.set_always_on_top(true) {
        let _ = window.set_minimizable(true);
        return Err(error.to_string());
    }
    Ok(())
}

pub fn release_mcp_approval(app: &AppHandle, workspace_id: &str) -> Result<(), String> {
    let state = app.state::<WindowWorkspaceState>();
    let Some(window) = registered_workspace_window(app, workspace_id, &state)? else {
        return Ok(());
    };
    let minimizable = window
        .set_minimizable(true)
        .map_err(|error| error.to_string());
    let always_on_top = window
        .set_always_on_top(false)
        .map_err(|error| error.to_string());
    minimizable.and(always_on_top)
}

pub fn release_all_mcp_approvals(app: &AppHandle) {
    for window in app.webview_windows().values() {
        let _ = window.set_minimizable(true);
        let _ = window.set_always_on_top(false);
    }
}
