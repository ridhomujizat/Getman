use rusqlite::{params, Connection};

use crate::db::now;

use super::super::{
    security,
    types::{Capability, McpPolicy, PolicyInput},
};

fn map_policy(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpPolicy> {
    Ok(McpPolicy {
        id: row.get(0)?,
        client_id: row.get(1)?,
        workspace_id: row.get(2)?,
        collection_id: row.get(3)?,
        environment_id: row.get(4)?,
        capability: Capability::parse(&row.get::<_, String>(5)?),
        environment_class: row.get(6)?,
        environment_use: row.get(7)?,
        approval_mode: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub fn list(connection: &Connection) -> Result<Vec<McpPolicy>, String> {
    let mut query = connection.prepare("SELECT id,client_id,workspace_id,collection_id,environment_id,capability,environment_class,environment_use,approval_mode,created_at,updated_at FROM mcp_policies ORDER BY updated_at DESC").map_err(|error| error.to_string())?;
    let records = query
        .query_map([], map_policy)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(records)
}

pub fn upsert(connection: &Connection, input: PolicyInput) -> Result<McpPolicy, String> {
    let id = input.id.unwrap_or(security::new_id("policy")?);
    let timestamp = now();
    connection.execute("INSERT INTO mcp_policies (id,client_id,workspace_id,collection_id,environment_id,capability,environment_class,environment_use,approval_mode,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id,workspace_id=excluded.workspace_id,collection_id=excluded.collection_id,environment_id=excluded.environment_id,capability=excluded.capability,environment_class=excluded.environment_class,environment_use=excluded.environment_use,approval_mode=excluded.approval_mode,updated_at=excluded.updated_at", params![id,input.client_id,input.workspace_id,input.collection_id,input.environment_id,input.capability.as_str(),input.environment_class,input.environment_use,input.approval_mode,timestamp]).map_err(|error| error.to_string())?;
    connection.query_row("SELECT id,client_id,workspace_id,collection_id,environment_id,capability,environment_class,environment_use,approval_mode,created_at,updated_at FROM mcp_policies WHERE id=?1", [id], map_policy).map_err(|error| error.to_string())
}

pub fn matching(
    connection: &Connection,
    client_id: &str,
    workspace_id: Option<&str>,
    collection_id: Option<&str>,
    environment_id: Option<&str>,
) -> Result<Vec<McpPolicy>, String> {
    let policies = list(connection)?;
    Ok(policies
        .into_iter()
        .filter(|policy| {
            policy
                .client_id
                .as_deref()
                .is_none_or(|value| value == client_id)
                && policy
                    .workspace_id
                    .as_deref()
                    .is_none_or(|value| Some(value) == workspace_id)
                && policy
                    .collection_id
                    .as_deref()
                    .is_none_or(|value| Some(value) == collection_id)
                && policy
                    .environment_id
                    .as_deref()
                    .is_none_or(|value| Some(value) == environment_id)
        })
        .collect())
}
