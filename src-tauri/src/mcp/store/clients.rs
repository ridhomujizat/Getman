use rusqlite::{params, Connection, OptionalExtension};

use crate::db::now;

use super::super::{
    security,
    types::{AuthenticatedSession, Capability, McpClient},
};

fn map_client(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpClient> {
    Ok(McpClient {
        id: row.get(0)?,
        kind: row.get(1)?,
        display_name: row.get(2)?,
        config_path: row.get(3)?,
        enabled: row.get(4)?,
        capability: Capability::parse(&row.get::<_, String>(5)?),
        installed_at: row.get(6)?,
        last_seen_at: row.get(7)?,
    })
}

pub fn list(connection: &Connection) -> Result<Vec<McpClient>, String> {
    let mut query = connection.prepare("SELECT id,kind,display_name,config_path,enabled,capability,installed_at,last_seen_at FROM mcp_clients ORDER BY display_name").map_err(|error| error.to_string())?;
    let records = query
        .query_map([], map_client)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(records)
}

pub fn get(connection: &Connection, id: &str) -> Result<Option<McpClient>, String> {
    connection.query_row("SELECT id,kind,display_name,config_path,enabled,capability,installed_at,last_seen_at FROM mcp_clients WHERE id=?1", [id], map_client).optional().map_err(|error| error.to_string())
}

pub fn upsert(
    connection: &Connection,
    kind: &str,
    display_name: &str,
    config_path: Option<&str>,
    token: &str,
) -> Result<McpClient, String> {
    let existing = connection
        .query_row(
            "SELECT id FROM mcp_clients WHERE kind=?1 AND COALESCE(config_path,'')=COALESCE(?2,'')",
            params![kind, config_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(id) = existing.as_deref() {
        connection.execute("UPDATE mcp_sessions SET ended_at=?1,end_reason='token_rotated' WHERE client_id=?2 AND ended_at IS NULL", params![now(),id]).map_err(|error| error.to_string())?;
    }
    let id = existing.unwrap_or(security::new_id("client")?);
    connection.execute("INSERT INTO mcp_clients (id,kind,display_name,config_path,token_hash,enabled,capability,installed_at) VALUES (?1,?2,?3,?4,?5,1,'read',?6) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,config_path=excluded.config_path,token_hash=excluded.token_hash,enabled=1,installed_at=excluded.installed_at", params![id,kind,display_name,config_path,security::hash(token),now()]).map_err(|error| error.to_string())?;
    get(connection, &id)?.ok_or_else(|| "Client was not saved".into())
}

pub fn set_access(
    connection: &Connection,
    id: &str,
    enabled: bool,
    capability: Capability,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE mcp_clients SET enabled=?1,capability=?2 WHERE id=?3",
            params![enabled, capability.as_str(), id],
        )
        .map_err(|error| error.to_string())?;
    if !enabled {
        connection.execute("UPDATE mcp_sessions SET ended_at=?1,end_reason='revoked' WHERE client_id=?2 AND ended_at IS NULL", params![now(),id]).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn remove(connection: &Connection, id: &str) -> Result<(), String> {
    set_access(connection, id, false, Capability::Deny)
}

pub fn authenticate(
    connection: &Connection,
    client_id: &str,
    token: &str,
    protocol_version: &str,
    requested_session: Option<&str>,
) -> Result<AuthenticatedSession, String> {
    let record = connection.query_row("SELECT id,kind,display_name,config_path,enabled,capability,installed_at,last_seen_at,token_hash FROM mcp_clients WHERE id=?1", [client_id], |row| Ok((map_client(row)?, row.get::<_, String>(8)?))).optional().map_err(|error| error.to_string())?.ok_or("Client is not configured")?;
    if !record.0.enabled || !security::token_matches(&record.1, token) {
        return Err("Client authentication failed".into());
    }
    let session_id = if let Some(session_id) = requested_session {
        let exists = connection.query_row("SELECT EXISTS(SELECT 1 FROM mcp_sessions WHERE id=?1 AND client_id=?2 AND ended_at IS NULL)", params![session_id,client_id], |row| row.get::<_, bool>(0)).map_err(|error| error.to_string())?;
        if !exists {
            return Err("Session is no longer active".into());
        }
        session_id.to_owned()
    } else {
        let id = security::new_id("session")?;
        connection.execute("INSERT INTO mcp_sessions (id,client_id,protocol_version,started_at,last_seen_at) VALUES (?1,?2,?3,?4,?4)", params![id,client_id,protocol_version,now()]).map_err(|error| error.to_string())?;
        id
    };
    connection
        .execute(
            "UPDATE mcp_sessions SET last_seen_at=?1 WHERE id=?2",
            params![now(), session_id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE mcp_clients SET last_seen_at=?1 WHERE id=?2",
            params![now(), client_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(AuthenticatedSession {
        id: session_id,
        client: record.0,
    })
}

pub fn active_session_count(connection: &Connection) -> Result<usize, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM mcp_sessions WHERE ended_at IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count as usize)
        .map_err(|error| error.to_string())
}
