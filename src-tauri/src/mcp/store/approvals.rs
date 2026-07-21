use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::db::now;

use super::{json, parse_json, parse_list};
use crate::mcp::{security, types::McpApproval};

fn map_approval(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpApproval> {
    Ok(McpApproval {
        id: row.get(0)?,
        activity_id: row.get(1)?,
        workspace_id: row.get(2)?,
        client_name: row.get(3)?,
        tool_name: row.get(4)?,
        request_fingerprint: row.get(5)?,
        risk_reasons: parse_list(row.get(6)?),
        summary: parse_json(row.get(7)?),
        decision: row.get(8)?,
        requested_at: row.get(9)?,
        decided_at: row.get(10)?,
        expires_at: row.get(11)?,
    })
}

pub fn create(
    connection: &Connection,
    activity_id: &str,
    workspace_id: Option<&str>,
    fingerprint: &str,
    reasons: &[String],
    summary: &Value,
    timeout_ms: i64,
) -> Result<McpApproval, String> {
    let id = security::new_id("approval")?;
    let requested = now();
    connection.execute("INSERT INTO mcp_approvals (id,activity_id,workspace_id,request_fingerprint,risk_reasons_json,summary_json,decision,requested_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8)", params![id,activity_id,workspace_id,fingerprint,serde_json::to_string(reasons).map_err(|error| error.to_string())?,json(summary)?,requested,requested+timeout_ms]).map_err(|error| error.to_string())?;
    get(connection, &id)?.ok_or_else(|| "Approval was not created".into())
}

pub fn get(connection: &Connection, id: &str) -> Result<Option<McpApproval>, String> {
    connection.query_row("SELECT p.id,p.activity_id,p.workspace_id,COALESCE(c.display_name,a.client_id),a.tool_name,p.request_fingerprint,p.risk_reasons_json,p.summary_json,p.decision,p.requested_at,p.decided_at,p.expires_at FROM mcp_approvals p JOIN mcp_activity a ON a.id=p.activity_id LEFT JOIN mcp_clients c ON c.id=a.client_id WHERE p.id=?1", [id], map_approval).optional().map_err(|error| error.to_string())
}

pub fn list_pending(
    connection: &Connection,
    workspace_id: Option<&str>,
) -> Result<Vec<McpApproval>, String> {
    let mut statement = connection.prepare("SELECT p.id,p.activity_id,p.workspace_id,COALESCE(c.display_name,a.client_id),a.tool_name,p.request_fingerprint,p.risk_reasons_json,p.summary_json,p.decision,p.requested_at,p.decided_at,p.expires_at FROM mcp_approvals p JOIN mcp_activity a ON a.id=p.activity_id LEFT JOIN mcp_clients c ON c.id=a.client_id WHERE p.decision='pending' ORDER BY p.requested_at").map_err(|error| error.to_string())?;
    let records = statement
        .query_map([], map_approval)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(records
        .into_iter()
        .filter(|record| workspace_id.is_none() || record.workspace_id.as_deref() == workspace_id)
        .collect())
}

pub fn decide(connection: &Connection, id: &str, decision: &str) -> Result<(), String> {
    if !matches!(decision, "allow_once" | "allow_session" | "deny") {
        return Err("Invalid approval decision".into());
    }
    let changed = connection.execute("UPDATE mcp_approvals SET decision=?1,decided_at=?2 WHERE id=?3 AND decision='pending' AND expires_at>=?2", params![decision,now(),id]).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Approval is no longer pending".into());
    }
    Ok(())
}

pub fn expire(connection: &Connection, id: &str) -> Result<(), String> {
    connection.execute("UPDATE mcp_approvals SET decision='expired',decided_at=?1 WHERE id=?2 AND decision='pending'", params![now(),id]).map_err(|error| error.to_string())?;
    Ok(())
}
