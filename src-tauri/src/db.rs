use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{
    mcp,
    workspace::{self, WorkspaceFile},
};

pub struct RegistryState(pub Mutex<Connection>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub sync_type: String,
    pub root_path: String,
    pub git_remote: Option<String>,
    pub git_branch: Option<String>,
    pub created_at: i64,
    pub last_opened_at: Option<i64>,
}

pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub(crate) fn new_id() -> String {
    format!("ws-{}-{}", std::process::id(), now())
}

pub(crate) fn configure(connection: &Connection) -> Result<(), String> {
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection.execute_batch("CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, sync_type TEXT NOT NULL CHECK (sync_type IN ('local','git','cloud')), root_path TEXT NOT NULL UNIQUE, git_remote TEXT, git_branch TEXT, created_at INTEGER NOT NULL, last_opened_at INTEGER); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cloud_connections (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, base_url TEXT NOT NULL, remote_workspace_id TEXT NOT NULL, device_id TEXT NOT NULL, role TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '', connected_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS cloud_entity_revisions (workspace_id TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(workspace_id,entity_id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);").map_err(|error| error.to_string())?;
    mcp::schema::migrate(connection)
}

fn app_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("tesapi"))
        .map_err(|error| error.to_string())
}

pub(crate) fn migrate_json(connection: &Connection, root: &Path) -> Result<(), String> {
    let legacy = root.join("workspaces.json");
    let has_rows = connection
        .query_row("SELECT EXISTS(SELECT 1 FROM workspaces)", [], |row| {
            row.get::<_, bool>(0)
        })
        .map_err(|error| error.to_string())?;
    if !legacy.exists() || has_rows {
        return Ok(());
    }
    let value: Value =
        serde_json::from_str(&fs::read_to_string(&legacy).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let active = value
        .get("activeWorkspaceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    for item in value
        .get("workspaces")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("My Workspace");
        let storage = item.get("storage").cloned().unwrap_or(Value::Null);
        let sync_type = if storage
            .get("git")
            .and_then(|git| git.get("enabled"))
            .and_then(Value::as_bool)
            == Some(true)
        {
            "git"
        } else {
            storage
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("local")
        };
        let path = storage
            .get("rootPath")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("workspaces").join(id));
        connection.execute("INSERT OR IGNORE INTO workspaces (id,name,sync_type,root_path,created_at,last_opened_at) VALUES (?1,?2,?3,?4,?5,?6)", params![id, name, sync_type, path.to_string_lossy(), now(), if id == active { Some(now()) } else { None }]).map_err(|error| error.to_string())?;
        workspace::write_descriptor(
            &path,
            &WorkspaceFile {
                schema_version: 1,
                id: id.into(),
                name: name.into(),
                sync_type: sync_type.into(),
                git_remote: None,
                git_branch: (sync_type == "git").then(|| "main".into()),
            },
        )?;
    }
    fs::rename(&legacy, root.join("workspaces.json.migrated")).map_err(|error| error.to_string())
}

pub fn initialize(app: &AppHandle) -> Result<RegistryState, String> {
    let root = app_root(app)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let connection = Connection::open(root.join("app.db")).map_err(|error| error.to_string())?;
    configure(&connection)?;
    migrate_json(&connection, &root)?;
    let has_rows = connection
        .query_row("SELECT EXISTS(SELECT 1 FROM workspaces)", [], |row| {
            row.get::<_, bool>(0)
        })
        .map_err(|error| error.to_string())?;
    if !has_rows {
        let id = new_id();
        let path = root.join("workspaces").join(&id);
        let descriptor = workspace::create_folder(
            WorkspaceFile {
                schema_version: 1,
                id: id.clone(),
                name: "My Workspace".into(),
                sync_type: "local".into(),
                git_remote: None,
                git_branch: None,
            },
            &path,
        )?;
        connection.execute("INSERT INTO workspaces (id,name,sync_type,root_path,created_at,last_opened_at) VALUES (?1,?2,'local',?3,?4,?4)", params![descriptor.id, descriptor.name, path.to_string_lossy(), now()]).map_err(|error| error.to_string())?;
    }
    Ok(RegistryState(Mutex::new(connection)))
}

pub(crate) fn map_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceRecord> {
    Ok(WorkspaceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        sync_type: row.get(2)?,
        root_path: row.get(3)?,
        git_remote: row.get(4)?,
        git_branch: row.get(5)?,
        created_at: row.get(6)?,
        last_opened_at: row.get(7)?,
    })
}

pub(crate) fn delete_workspace(connection: &mut Connection, id: &str) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let workspace_count = transaction
        .query_row("SELECT COUNT(*) FROM workspaces", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?;
    if workspace_count <= 1 {
        return Err("TesAPI needs at least one workspace.".into());
    }
    let removed = transaction
        .execute("DELETE FROM workspaces WHERE id=?1", [id])
        .map_err(|error| error.to_string())?;
    if removed == 0 {
        return Err("Workspace not found.".into());
    }
    let setting_prefix = format!("workspace:{id}:");
    transaction
        .execute(
            "DELETE FROM settings WHERE substr(key,1,length(?1))=?1",
            [setting_prefix],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM settings WHERE key='last_workspace_id' AND value=?1",
            [serde_json::to_string(id).map_err(|error| error.to_string())?],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM cloud_entity_revisions WHERE workspace_id=?1",
            [id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM cloud_connections WHERE workspace_id=?1", [id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM mcp_policies WHERE workspace_id=?1", [id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM mcp_drafts WHERE workspace_id=?1", [id])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}
