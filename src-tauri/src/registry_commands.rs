use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    db::{delete_workspace, map_workspace, new_id, now, RegistryState, WorkspaceRecord},
    workspace::{self, WorkspaceFile},
    workspace_io::WorkspaceQueueState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceInput {
    pub name: String,
    pub root_path: String,
    pub sync_type: String,
    pub git_remote: Option<String>,
    pub git_branch: Option<String>,
}

fn connection<'a>(
    state: &'a State<'_, RegistryState>,
) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Workspace registry lock poisoned".to_string())
}

#[tauri::command]
pub fn registry_list_workspaces(
    state: State<'_, RegistryState>,
) -> Result<Vec<WorkspaceRecord>, String> {
    let connection = connection(&state)?;
    let mut query = connection.prepare("SELECT id,name,sync_type,root_path,git_remote,git_branch,created_at,last_opened_at FROM workspaces ORDER BY COALESCE(last_opened_at,created_at) DESC").map_err(|error| error.to_string())?;
    let records = query
        .query_map([], map_workspace)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(records)
}

#[tauri::command]
pub fn registry_get_workspace(
    id: String,
    state: State<'_, RegistryState>,
) -> Result<Option<WorkspaceRecord>, String> {
    connection(&state)?.query_row("SELECT id,name,sync_type,root_path,git_remote,git_branch,created_at,last_opened_at FROM workspaces WHERE id=?1", [id], map_workspace).optional().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn registry_get_setting(
    key: String,
    state: State<'_, RegistryState>,
) -> Result<Option<String>, String> {
    connection(&state)?
        .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn registry_set_setting(
    key: String,
    value: String,
    state: State<'_, RegistryState>,
) -> Result<(), String> {
    connection(&state)?.execute("INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value]).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn registry_touch_workspace(id: String, state: State<'_, RegistryState>) -> Result<(), String> {
    connection(&state)?
        .execute(
            "UPDATE workspaces SET last_opened_at=?1 WHERE id=?2",
            params![now(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn registry_create_workspace(
    input: CreateWorkspaceInput,
    state: State<'_, RegistryState>,
    queue: State<'_, WorkspaceQueueState>,
) -> Result<WorkspaceRecord, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Workspace name is required.".into());
    }
    if !matches!(input.sync_type.as_str(), "local" | "git" | "cloud") {
        return Err("Unsupported workspace sync method.".into());
    }
    let root = PathBuf::from(input.root_path.trim());
    if root.as_os_str().is_empty() {
        return Err("Workspace location is required.".into());
    }
    let workspace_lock = queue.lock_for(&root)?;
    let _workspace_guard = workspace_lock
        .lock()
        .map_err(|_| "Workspace queue lock poisoned".to_string())?;
    let descriptor = workspace::create_folder(
        WorkspaceFile {
            schema_version: 1,
            id: new_id(),
            name: name.into(),
            sync_type: input.sync_type.clone(),
            git_remote: input
                .git_remote
                .clone()
                .filter(|value| !value.trim().is_empty()),
            git_branch: (input.sync_type == "git").then(|| {
                input
                    .git_branch
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "main".into())
            }),
        },
        &root,
    )?;
    let connection = connection(&state)?;
    let existing_id: Option<String> = connection
        .query_row(
            "SELECT id FROM workspaces WHERE root_path=?1",
            [&root.to_string_lossy()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let id = existing_id.unwrap_or_else(|| descriptor.id.clone());
    if id != descriptor.id {
        workspace::write_descriptor(
            &root,
            &WorkspaceFile {
                id: id.clone(),
                ..descriptor.clone()
            },
        )?;
    }
    let record = WorkspaceRecord {
        id,
        name: descriptor.name,
        sync_type: descriptor.sync_type,
        root_path: root.to_string_lossy().into_owned(),
        git_remote: descriptor.git_remote,
        git_branch: descriptor.git_branch,
        created_at: now(),
        last_opened_at: Some(now()),
    };
    connection.execute("INSERT INTO workspaces (id,name,sync_type,root_path,git_remote,git_branch,created_at,last_opened_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sync_type=excluded.sync_type,root_path=excluded.root_path,git_remote=excluded.git_remote,git_branch=excluded.git_branch,last_opened_at=excluded.last_opened_at", params![record.id,record.name,record.sync_type,record.root_path,record.git_remote,record.git_branch,record.created_at,record.last_opened_at]).map_err(|error| error.to_string())?;
    Ok(record)
}

#[tauri::command]
pub fn registry_rename_workspace(
    id: String,
    name: String,
    state: State<'_, RegistryState>,
    queue: State<'_, WorkspaceQueueState>,
) -> Result<WorkspaceRecord, String> {
    let connection = connection(&state)?;
    let mut record = connection.query_row("SELECT id,name,sync_type,root_path,git_remote,git_branch,created_at,last_opened_at FROM workspaces WHERE id=?1", [&id], map_workspace).map_err(|error| error.to_string())?;
    let next = name.trim();
    if next.is_empty() {
        return Err("Workspace name is required.".into());
    }
    record.name = next.into();
    let root = Path::new(&record.root_path);
    if workspace::read_descriptor(root)?.schema_version > 1 {
        return Err("Workspace uses a newer schema. Upgrade TesAPI before renaming it.".into());
    }
    let workspace_lock = queue.lock_for(root)?;
    let _workspace_guard = workspace_lock
        .lock()
        .map_err(|_| "Workspace queue lock poisoned".to_string())?;
    workspace::write_descriptor(
        root,
        &WorkspaceFile {
            schema_version: 1,
            id: record.id.clone(),
            name: record.name.clone(),
            sync_type: record.sync_type.clone(),
            git_remote: record.git_remote.clone(),
            git_branch: record.git_branch.clone(),
        },
    )?;
    connection
        .execute(
            "UPDATE workspaces SET name=?1 WHERE id=?2",
            params![record.name, record.id],
        )
        .map_err(|error| error.to_string())?;
    Ok(record)
}

#[tauri::command]
pub fn registry_delete_workspace(
    id: String,
    state: State<'_, RegistryState>,
) -> Result<(), String> {
    let mut connection = connection(&state)?;
    let cloud = connection
        .query_row(
            "SELECT sync_type='cloud' FROM workspaces WHERE id=?1",
            [&id],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);
    delete_workspace(&mut connection, &id)?;
    drop(connection);
    if cloud {
        if let Ok(credential) = crate::cloud_support::credential(&id) {
            let _ = credential.delete_credential();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn registry_default_workspace_path(app: AppHandle, slug: String) -> Result<String, String> {
    app.path()
        .document_dir()
        .map(|path| {
            path.join("tesapi")
                .join(slug)
                .to_string_lossy()
                .into_owned()
        })
        .map_err(|error| error.to_string())
}
