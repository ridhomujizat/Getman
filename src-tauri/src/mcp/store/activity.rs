use rusqlite::{params, Connection};
use serde_json::Value;

use crate::db::now;

use super::{json, parse_json, parse_list};
use crate::mcp::{
    security,
    types::{ActivityQuery, McpActivity},
};

pub struct ActivityStart<'a> {
    pub session_id: &'a str,
    pub client_id: &'a str,
    pub tool_name: &'a str,
    pub workspace_id: Option<&'a str>,
    pub collection_id: Option<&'a str>,
    pub request_id: Option<&'a str>,
    pub draft_id: Option<&'a str>,
    pub input_summary: &'a Value,
}

pub fn start(connection: &Connection, input: ActivityStart<'_>) -> Result<String, String> {
    let id = security::new_id("activity")?;
    connection.execute("INSERT INTO mcp_activity (id,session_id,client_id,tool_name,workspace_id,collection_id,request_id,draft_id,status,input_summary_json,started_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9,?10)", params![id,input.session_id,input.client_id,input.tool_name,input.workspace_id,input.collection_id,input.request_id,input.draft_id,json(input.input_summary)?,now()]).map_err(|error| error.to_string())?;
    Ok(id)
}

pub fn set_status(
    connection: &Connection,
    id: &str,
    status: &str,
    reasons: &[String],
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE mcp_activity SET status=?1,policy_reasons_json=?2 WHERE id=?3",
            params![
                status,
                serde_json::to_string(reasons).map_err(|error| error.to_string())?,
                id
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn finish(
    connection: &Connection,
    id: &str,
    status: &str,
    output: &Value,
    error_code: Option<&str>,
    error_detail: Option<&str>,
) -> Result<(), String> {
    let completed = now();
    connection.execute("UPDATE mcp_activity SET status=?1,output_summary_json=?2,error_code=?3,error_detail=?4,completed_at=?5,duration_ms=?5-started_at WHERE id=?6", params![status,json(output)?,error_code,error_detail,completed,id]).map_err(|error| error.to_string())?;
    Ok(())
}

fn map_activity(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpActivity> {
    Ok(McpActivity {
        id: row.get(0)?,
        session_id: row.get(1)?,
        client_id: row.get(2)?,
        client_name: row.get(3)?,
        tool_name: row.get(4)?,
        workspace_id: row.get(5)?,
        collection_id: row.get(6)?,
        request_id: row.get(7)?,
        draft_id: row.get(8)?,
        status: row.get(9)?,
        policy_reasons: parse_list(row.get(10)?),
        input_summary: parse_json(row.get(11)?),
        output_summary: parse_json(row.get(12)?),
        error_code: row.get(13)?,
        error_detail: row.get(14)?,
        approval_id: row.get(15)?,
        approval_decision: row.get(16)?,
        approval_requested_at: row.get(17)?,
        approval_decided_at: row.get(18)?,
        started_at: row.get(19)?,
        completed_at: row.get(20)?,
        duration_ms: row.get(21)?,
    })
}

pub fn list(connection: &Connection, query: ActivityQuery) -> Result<Vec<McpActivity>, String> {
    let limit = query.limit.unwrap_or(500).clamp(1, 2_000);
    let offset = query.offset.unwrap_or(0);
    let mut statement = connection.prepare("SELECT a.id,a.session_id,a.client_id,COALESCE(c.display_name,a.client_id),a.tool_name,a.workspace_id,a.collection_id,a.request_id,a.draft_id,a.status,a.policy_reasons_json,a.input_summary_json,a.output_summary_json,a.error_code,a.error_detail,p.id,p.decision,p.requested_at,p.decided_at,a.started_at,a.completed_at,a.duration_ms FROM mcp_activity a LEFT JOIN mcp_clients c ON c.id=a.client_id LEFT JOIN mcp_approvals p ON p.activity_id=a.id ORDER BY a.started_at DESC LIMIT 10000").map_err(|error| error.to_string())?;
    let records = statement
        .query_map([], map_activity)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let search = query.search.unwrap_or_default().to_ascii_lowercase();
    Ok(records
        .into_iter()
        .filter(|record| {
            query
                .client_id
                .as_deref()
                .is_none_or(|value| record.client_id == value)
                && query
                    .tool_name
                    .as_deref()
                    .is_none_or(|value| record.tool_name == value)
                && query
                    .workspace_id
                    .as_deref()
                    .is_none_or(|value| record.workspace_id.as_deref() == Some(value))
                && query
                    .status
                    .as_deref()
                    .is_none_or(|value| record.status == value)
                && query
                    .approval_decision
                    .as_deref()
                    .is_none_or(|value| record.approval_decision.as_deref() == Some(value))
                && query
                    .session_id
                    .as_deref()
                    .is_none_or(|value| record.session_id == value)
                && query
                    .started_after
                    .is_none_or(|value| record.started_at >= value)
                && query
                    .started_before
                    .is_none_or(|value| record.started_at <= value)
                && (search.is_empty()
                    || format!(
                        "{} {} {} {} {} {:?} {:?}",
                        record.client_name,
                        record.tool_name,
                        record.status,
                        record.approval_decision.as_deref().unwrap_or_default(),
                        record.error_detail.as_deref().unwrap_or_default(),
                        record.input_summary,
                        record.output_summary
                    )
                    .to_ascii_lowercase()
                    .contains(&search))
        })
        .skip(offset)
        .take(limit)
        .collect())
}

pub fn clear(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM mcp_approvals WHERE activity_id IN (SELECT id FROM mcp_activity)",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM mcp_activity", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn enforce_retention(connection: &Connection, days: i64, max_rows: i64) -> Result<(), String> {
    let cutoff = now() - days.max(1) * 86_400_000;
    connection
        .execute("DELETE FROM mcp_activity WHERE started_at < ?1", [cutoff])
        .map_err(|error| error.to_string())?;
    connection.execute("DELETE FROM mcp_activity WHERE id IN (SELECT id FROM mcp_activity ORDER BY started_at DESC LIMIT -1 OFFSET ?1)", [max_rows.max(100)]).map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM mcp_approvals WHERE activity_id NOT IN (SELECT id FROM mcp_activity)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
