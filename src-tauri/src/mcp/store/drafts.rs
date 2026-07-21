use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::db::now;

use super::{json, parse_json};
use crate::mcp::{security, types::McpDraft};

fn map_draft(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpDraft> {
    Ok(McpDraft {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        origin_collection_id: row.get(2)?,
        origin_request_id: row.get(3)?,
        created_by_client_id: row.get(4)?,
        created_by_session_id: row.get(5)?,
        revision: row.get(6)?,
        request: parse_json(row.get(7)?),
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        expires_at: row.get(10)?,
    })
}

pub fn create(
    connection: &Connection,
    workspace_id: &str,
    collection_id: Option<&str>,
    request_id: Option<&str>,
    client_id: &str,
    session_id: &str,
    request: &Value,
) -> Result<McpDraft, String> {
    let id = security::new_id("draft")?;
    let timestamp = now();
    let expires = timestamp + 7 * 86_400_000;
    connection.execute("INSERT INTO mcp_drafts (id,workspace_id,origin_collection_id,origin_request_id,created_by_client_id,created_by_session_id,revision,request_json,created_at,updated_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,1,?7,?8,?8,?9)", params![id,workspace_id,collection_id,request_id,client_id,session_id,json(request)?,timestamp,expires]).map_err(|error| error.to_string())?;
    get(connection, &id)?.ok_or_else(|| "Draft was not saved".into())
}

pub fn get(connection: &Connection, id: &str) -> Result<Option<McpDraft>, String> {
    connection.query_row("SELECT id,workspace_id,origin_collection_id,origin_request_id,created_by_client_id,created_by_session_id,revision,request_json,created_at,updated_at,expires_at FROM mcp_drafts WHERE id=?1", [id], map_draft).optional().map_err(|error| error.to_string())
}

pub fn update(
    connection: &Connection,
    id: &str,
    expected_revision: i64,
    request: &Value,
) -> Result<McpDraft, String> {
    let changed = connection.execute("UPDATE mcp_drafts SET request_json=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND revision=?4", params![json(request)?,now(),id,expected_revision]).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("STALE_DRAFT: The draft changed before this update.".into());
    }
    get(connection, id)?.ok_or_else(|| "Draft no longer exists".into())
}

#[cfg(test)]
mod tests {
    use super::{create, update};
    use crate::mcp::schema;
    use rusqlite::Connection;
    use serde_json::json;

    #[test]
    fn update_should_reject_stale_revision() {
        let connection = Connection::open_in_memory().unwrap();
        schema::migrate(&connection).unwrap();
        let draft = create(
            &connection,
            "workspace",
            None,
            None,
            "client",
            "session",
            &json!({"method":"GET"}),
        )
        .unwrap();
        let error = update(&connection, &draft.id, 2, &json!({"method":"POST"})).unwrap_err();
        assert!(error.starts_with("STALE_DRAFT"));
    }
}
