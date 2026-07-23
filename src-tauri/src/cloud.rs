use reqwest::{Client, StatusCode};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::{
    cloud_support::{
        credential, load_connection, parse_connection, save_revision, status_from_db, uuid_v4,
        CloudStatus,
    },
    db::RegistryState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentResponse {
    device_token: String,
    device: Device,
    workspace: RemoteWorkspace,
}

#[derive(Debug, Deserialize)]
struct Device {
    id: String,
    role: String,
}

#[derive(Debug, Deserialize)]
struct RemoteWorkspace {
    id: String,
}

#[tauri::command]
pub async fn cloud_connect(
    workspace_id: String,
    connection_url: String,
    device_name: String,
    state: State<'_, RegistryState>,
) -> Result<CloudStatus, String> {
    let (base_url, enrollment) = parse_connection(&connection_url)?;
    let device_name = device_name.trim();
    if device_name.is_empty() || device_name.len() > 120 {
        return Err("Device name must be between 1 and 120 characters.".into());
    }
    let response = Client::new()
        .post(format!("{base_url}/v1/enrollments/exchange"))
        .json(&json!({"enrollmentToken": enrollment, "deviceName": device_name}))
        .send()
        .await
        .map_err(|error| format!("Cloud enrollment failed: {error}"))?;
    if response.status() != StatusCode::CREATED {
        return Err(
            "Cloud enrollment was rejected. The connection URL may be expired or already used."
                .into(),
        );
    }
    let enrolled = response
        .json::<EnrollmentResponse>()
        .await
        .map_err(|_| "Cloud enrollment returned an invalid response.".to_string())?;
    let stored_credential = credential(&workspace_id)?;
    stored_credential
        .set_password(&enrolled.device_token)
        .map_err(|error| format!("Store cloud credential: {error}"))?;
    let save_result = (|| {
        let connection = state
            .0
            .lock()
            .map_err(|_| "Cloud registry lock poisoned".to_string())?;
        connection.execute(
            "INSERT INTO cloud_connections (workspace_id,base_url,remote_workspace_id,device_id,role,cursor,connected_at) VALUES (?1,?2,?3,?4,?5,'',?6) ON CONFLICT(workspace_id) DO UPDATE SET base_url=excluded.base_url,remote_workspace_id=excluded.remote_workspace_id,device_id=excluded.device_id,role=excluded.role,cursor='',connected_at=excluded.connected_at",
            params![workspace_id, base_url, enrolled.workspace.id, enrolled.device.id, enrolled.device.role, crate::db::now()],
        ).map_err(|error| error.to_string())?;
        connection
            .execute(
                "UPDATE workspaces SET sync_type='cloud' WHERE id=?1",
                [&workspace_id],
            )
            .map_err(|error| error.to_string())?;
        Ok::<_, String>(())
    })();
    if let Err(error) = save_result {
        let _ = stored_credential.delete_credential();
        return Err(error);
    }
    status_from_db(&state, &workspace_id)
}

#[tauri::command]
pub fn cloud_status(
    workspace_id: String,
    state: State<'_, RegistryState>,
) -> Result<CloudStatus, String> {
    status_from_db(&state, &workspace_id)
}

#[tauri::command]
pub async fn cloud_snapshot(
    workspace_id: String,
    state: State<'_, RegistryState>,
) -> Result<Value, String> {
    let (base_url, remote_workspace_id, token) = load_connection(&state, &workspace_id)?;
    let response = Client::new()
        .get(format!(
            "{base_url}/v1/workspaces/{remote_workspace_id}/snapshot"
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Cloud pull failed: {error}"))?;
    if !response.status().is_success() {
        return Err(
            "Cloud pull was rejected. Reconnect this workspace if its device was revoked.".into(),
        );
    }
    let snapshot = response
        .json::<Value>()
        .await
        .map_err(|_| "Cloud returned an invalid snapshot.".to_string())?;
    let connection = state
        .0
        .lock()
        .map_err(|_| "Cloud registry lock poisoned".to_string())?;
    let cursor = snapshot
        .get("cursor")
        .and_then(Value::as_str)
        .unwrap_or_default();
    connection
        .execute(
            "UPDATE cloud_connections SET cursor=?1 WHERE workspace_id=?2",
            params![cursor, workspace_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(snapshot)
}

#[tauri::command]
pub fn cloud_accept_collection_revision(
    workspace_id: String,
    collection_id: String,
    revision: i64,
    state: State<'_, RegistryState>,
) -> Result<(), String> {
    save_revision(&state, &workspace_id, &collection_id, revision)
}

async fn push_collection(
    workspace_id: &str,
    collection_id: &str,
    payload: Option<Value>,
    state: &State<'_, RegistryState>,
) -> Result<i64, String> {
    let (base_url, remote_workspace_id, token) = load_connection(state, workspace_id)?;
    let base_revision = {
        let connection = state
            .0
            .lock()
            .map_err(|_| "Cloud registry lock poisoned".to_string())?;
        connection
            .query_row(
                "SELECT revision FROM cloud_entity_revisions WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, collection_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or(0)
    };
    let operation = if payload.is_none() {
        "delete"
    } else if base_revision == 0 {
        "create"
    } else {
        "update"
    };
    let mut mutation = json!({"mutationId": uuid_v4()?, "entityId": collection_id, "entityType": "collection", "operation": operation, "baseRevision": base_revision, "schemaVersion": 1});
    if let Some(payload) = payload {
        mutation["payload"] = payload;
    }
    let response = Client::new()
        .post(format!(
            "{base_url}/v1/workspaces/{remote_workspace_id}/mutations"
        ))
        .bearer_auth(token)
        .json(&json!({"mutations":[mutation]}))
        .send()
        .await
        .map_err(|error| format!("Cloud push failed: {error}"))?;
    if response.status() == StatusCode::CONFLICT {
        return Err(
            "Cloud revision conflict. Pull the workspace and review the remote collection.".into(),
        );
    }
    if !response.status().is_success() {
        return Err("Cloud push was rejected by the server.".into());
    }
    let body = response
        .json::<Value>()
        .await
        .map_err(|_| "Cloud returned an invalid mutation response.".to_string())?;
    let revision = body
        .get("results")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .and_then(|row| row.get("revision"))
        .and_then(Value::as_i64)
        .ok_or("Cloud response did not include a revision.")?;
    save_revision(state, workspace_id, collection_id, revision)?;
    Ok(revision)
}

#[tauri::command]
pub async fn cloud_push_collection(
    workspace_id: String,
    collection: Value,
    state: State<'_, RegistryState>,
) -> Result<i64, String> {
    let id = collection
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Collection ID is required.")?
        .to_string();
    push_collection(
        &workspace_id,
        &id,
        Some(json!({"collection": collection})),
        &state,
    )
    .await
}

#[tauri::command]
pub async fn cloud_delete_collection(
    workspace_id: String,
    collection_id: String,
    state: State<'_, RegistryState>,
) -> Result<i64, String> {
    push_collection(&workspace_id, &collection_id, None, &state).await
}

#[tauri::command]
pub fn cloud_disconnect(
    workspace_id: String,
    state: State<'_, RegistryState>,
) -> Result<(), String> {
    if let Ok(credential) = credential(&workspace_id) {
        let _ = credential.delete_credential();
    }
    let connection = state
        .0
        .lock()
        .map_err(|_| "Cloud registry lock poisoned".to_string())?;
    connection
        .execute(
            "DELETE FROM cloud_entity_revisions WHERE workspace_id=?1",
            [&workspace_id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM cloud_connections WHERE workspace_id=?1",
            [&workspace_id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE workspaces SET sync_type='local' WHERE id=?1",
            [&workspace_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn generated_mutation_id_is_uuid_v4() {
        let id = super::uuid_v4().unwrap();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
    }

    #[test]
    fn connection_url_requires_https_outside_localhost() {
        let (base, token) =
            super::parse_connection("http://127.0.0.1:18080/connect#enrollment=test").unwrap();
        assert_eq!(base, "http://127.0.0.1:18080");
        assert_eq!(token, "test");
        assert!(
            super::parse_connection("http://sync.example.com/connect#enrollment=test").is_err()
        );
    }
}
