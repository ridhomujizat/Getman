use keyring::Entry;
use reqwest::Url;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::db::RegistryState;

const KEYRING_SERVICE: &str = "com.tesapi.desktop.cloud";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub connected: bool,
    pub base_url: Option<String>,
    pub workspace_id: Option<String>,
    pub device_id: Option<String>,
    pub role: Option<String>,
    pub cursor: Option<String>,
}

pub fn credential(workspace_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, workspace_id)
        .map_err(|error| format!("Open TesAPI cloud credential: {error}"))
}

pub fn parse_connection(value: &str) -> Result<(String, String), String> {
    let url = Url::parse(value.trim()).map_err(|_| "Connection URL is invalid.".to_string())?;
    let host = url.host_str().ok_or("Connection URL host is required.")?;
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err(
            "Cloud connections require HTTPS. HTTP is allowed only for localhost development."
                .into(),
        );
    }
    let token = url
        .fragment()
        .and_then(|fragment| fragment.strip_prefix("enrollment="))
        .filter(|token| !token.is_empty())
        .ok_or("Connection URL is missing its enrollment secret.")?;
    Ok((url.origin().ascii_serialization(), token.to_string()))
}

pub fn status_from_db(
    state: &State<'_, RegistryState>,
    workspace_id: &str,
) -> Result<CloudStatus, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Cloud registry lock poisoned".to_string())?;
    connection.query_row(
        "SELECT base_url,remote_workspace_id,device_id,role,cursor FROM cloud_connections WHERE workspace_id=?1",
        [workspace_id],
        |row| Ok(CloudStatus { connected: true, base_url: Some(row.get(0)?), workspace_id: Some(row.get(1)?), device_id: Some(row.get(2)?), role: Some(row.get(3)?), cursor: Some(row.get(4)?) }),
    ).optional().map_err(|error| error.to_string()).map(|status| status.unwrap_or(CloudStatus { connected: false, base_url: None, workspace_id: None, device_id: None, role: None, cursor: None }))
}

pub fn load_connection(
    state: &State<'_, RegistryState>,
    workspace_id: &str,
) -> Result<(String, String, String), String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Cloud registry lock poisoned".to_string())?;
    let row = connection
        .query_row(
            "SELECT base_url,remote_workspace_id FROM cloud_connections WHERE workspace_id=?1",
            [workspace_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or("This workspace is not connected to TesAPI Cloud.")?;
    drop(connection);
    let token = credential(workspace_id)?
        .get_password()
        .map_err(|_| "Cloud credential is unavailable. Reconnect this workspace.".to_string())?;
    Ok((row.0, row.1, token))
}

pub fn save_revision(
    state: &State<'_, RegistryState>,
    workspace_id: &str,
    entity_id: &str,
    revision: i64,
) -> Result<(), String> {
    if entity_id.trim().is_empty() || revision < 1 {
        return Err("Cloud entity ID and positive revision are required.".into());
    }
    state.0.lock().map_err(|_| "Cloud registry lock poisoned".to_string())?.execute(
        "INSERT INTO cloud_entity_revisions (workspace_id,entity_id,revision) VALUES (?1,?2,?3) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET revision=excluded.revision",
        params![workspace_id, entity_id, revision],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn uuid_v4() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format!("{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}", bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]))
}
