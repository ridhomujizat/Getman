use std::time::Duration;

use serde_json::Value;
use tauri::Emitter;

use crate::{
    db::now,
    mcp::store::{activity, approvals},
};

use super::{with_connection, ToolContext, ToolError};

pub async fn request(
    context: &ToolContext<'_>,
    workspace_id: Option<&str>,
    fingerprint: &str,
    risks: &[String],
    summary: &Value,
    allow_session: bool,
) -> Result<(), ToolError> {
    if allow_session && has_session_grant(context, fingerprint).map_err(internal)? {
        return Ok(());
    }
    let approval = with_connection(context.app, |connection| {
        activity::set_status(connection, context.activity_id, "awaiting_approval", risks)?;
        approvals::create(
            connection,
            context.activity_id,
            workspace_id,
            fingerprint,
            risks,
            summary,
            60_000,
        )
    })
    .map_err(internal)?;
    let _ = context.app.emit("mcp-approval-changed", ());
    loop {
        let current = with_connection(context.app, |connection| {
            approvals::get(connection, &approval.id)
        })
        .map_err(internal)?
        .ok_or_else(|| ToolError::new("APPROVAL_CANCELLED", "Approval no longer exists"))?;
        match current.decision.as_str() {
            "allow_once" | "allow_session" => return Ok(()),
            "deny" => {
                return Err(ToolError::new(
                    "APPROVAL_DENIED",
                    "The user denied this action.",
                ))
            }
            "expired" | "cancelled" => {
                return Err(ToolError::new(
                    "APPROVAL_TIMEOUT",
                    "Approval expired before a decision.",
                ))
            }
            _ if now() >= current.expires_at => {
                let _ = with_connection(context.app, |connection| {
                    approvals::expire(connection, &approval.id)
                });
                let _ = context.app.emit("mcp-approval-changed", ());
                return Err(ToolError::new(
                    "APPROVAL_TIMEOUT",
                    "Approval expired before a decision.",
                ));
            }
            _ => tokio::time::sleep(Duration::from_millis(200)).await,
        }
    }
}

fn has_session_grant(context: &ToolContext<'_>, fingerprint: &str) -> Result<bool, String> {
    with_connection(context.app, |connection| {
        connection.query_row("SELECT EXISTS(SELECT 1 FROM mcp_approvals p JOIN mcp_activity a ON a.id=p.activity_id WHERE a.session_id=?1 AND p.request_fingerprint=?2 AND p.decision='allow_session')", rusqlite::params![context.session.id,fingerprint], |row| row.get::<_, bool>(0)).map_err(|error| error.to_string())
    })
}

fn internal(error: String) -> ToolError {
    ToolError::new("INTERNAL_ERROR", error)
}
