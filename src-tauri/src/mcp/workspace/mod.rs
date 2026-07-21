mod collections;
mod environments;
mod save;
mod structure;

pub use collections::{
    collection_documentation, get_request, get_request_raw, insert_into_folder, list_collections,
    search_requests,
};
pub use environments::{environment_metadata, list_environment_options, resolve_request};
pub use save::save_draft_request;
pub use structure::{create_collection, create_folder};

use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use crate::{
    db::{map_workspace, WorkspaceRecord},
    mcp::security,
    storage,
};

pub fn workspace(connection: &Connection, id: &str) -> Result<WorkspaceRecord, String> {
    connection.query_row("SELECT id,name,sync_type,root_path,git_remote,git_branch,created_at,last_opened_at FROM workspaces WHERE id=?1", [id], map_workspace).optional().map_err(|error| error.to_string())?.ok_or_else(|| "Workspace not found".into())
}

pub fn workspaces(connection: &Connection) -> Result<Vec<WorkspaceRecord>, String> {
    let mut statement = connection.prepare("SELECT id,name,sync_type,root_path,git_remote,git_branch,created_at,last_opened_at FROM workspaces ORDER BY name").map_err(|error| error.to_string())?;
    let records = statement
        .query_map([], map_workspace)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(records)
}

pub fn read_json(path: PathBuf) -> Result<Value, String> {
    serde_json::from_str(&std::fs::read_to_string(path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub fn safe_id(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value == "."
        || value == ".."
    {
        return Err("Invalid workspace entity ID".into());
    }
    Ok(value)
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let contents = format!(
        "{}\n",
        serde_json::to_string_pretty(&security::canonical(value))
            .map_err(|error| error.to_string())?
    );
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    storage::atomic_write_at(path, &contents)
}
