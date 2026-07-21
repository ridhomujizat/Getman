mod activity_view;

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::{
    db::RegistryState,
    mcp::{
        broker::BrokerState,
        config, policy,
        store::{activity, approvals, clients, policies},
        types::{
            ActivityQuery, Capability, ConfigPreview, McpActivity, McpApproval, McpClient,
            McpOverview, McpPolicy, McpSafetySettings, PolicyInput, WorkspaceCollectionOption,
            WorkspaceEnvironmentOption,
        },
        workspace,
    },
    windows,
};

use activity_view::{activity_csv, redact_activity};

fn connection<'a>(
    state: &'a State<'_, RegistryState>,
) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Registry database lock poisoned".to_string())
}

#[tauri::command]
pub fn mcp_overview(
    registry: State<'_, RegistryState>,
    broker: State<'_, BrokerState>,
) -> Result<McpOverview, String> {
    let connection = connection(&registry)?;
    Ok(McpOverview {
        enabled: policy::setting_bool(&connection, "mcp.enabled", false)?,
        read_only: policy::setting_bool(&connection, "mcp.read_only", true)?,
        broker_available: broker.available(),
        endpoint: broker.endpoint().into(),
        clients: config::overview(&connection, broker.endpoint())?,
        active_sessions: clients::active_session_count(&connection)?,
        safety: policy::safety_settings(&connection)?,
    })
}

#[tauri::command]
pub fn mcp_set_global_state(
    app: AppHandle,
    enabled: bool,
    read_only: bool,
    registry: State<'_, RegistryState>,
) -> Result<(), String> {
    let connection = connection(&registry)?;
    policy::set_setting_bool(&connection, "mcp.enabled", enabled)?;
    policy::set_setting_bool(&connection, "mcp.read_only", read_only)?;
    if !enabled {
        let timestamp = crate::db::now();
        connection.execute("UPDATE mcp_sessions SET ended_at=?1,end_reason='server_disabled' WHERE ended_at IS NULL", [timestamp]).map_err(|error| error.to_string())?;
        connection.execute("UPDATE mcp_approvals SET decision='cancelled',decided_at=?1 WHERE decision='pending'", [timestamp]).map_err(|error| error.to_string())?;
        windows::release_all_mcp_approvals(&app);
    }
    let _ = app.emit("mcp-state-changed", ());
    Ok(())
}

#[tauri::command]
pub fn mcp_set_safety_settings(
    app: AppHandle,
    settings: McpSafetySettings,
    registry: State<'_, RegistryState>,
) -> Result<McpSafetySettings, String> {
    let connection = connection(&registry)?;
    let settings = policy::set_safety_settings(&connection, &settings)?;
    activity::enforce_retention(
        &connection,
        settings.activity_retention_days,
        settings.activity_max_rows,
    )?;
    let _ = app.emit("mcp-state-changed", ());
    Ok(settings)
}

#[tauri::command]
pub fn mcp_config_preview(
    kind: String,
    broker: State<'_, BrokerState>,
) -> Result<ConfigPreview, String> {
    config::preview(&kind, broker.endpoint())
}

#[tauri::command]
pub fn mcp_install_config(
    app: AppHandle,
    kind: String,
    registry: State<'_, RegistryState>,
    broker: State<'_, BrokerState>,
) -> Result<McpClient, String> {
    let connection = connection(&registry)?;
    let client = config::install(&connection, &kind, broker.endpoint())?;
    let _ = app.emit("mcp-state-changed", ());
    Ok(client)
}

#[tauri::command]
pub fn mcp_generate_manual_config(
    app: AppHandle,
    kind: String,
    registry: State<'_, RegistryState>,
    broker: State<'_, BrokerState>,
) -> Result<ConfigPreview, String> {
    let connection = connection(&registry)?;
    let preview = config::generate_manual(&connection, &kind, broker.endpoint())?;
    let _ = app.emit("mcp-state-changed", ());
    Ok(preview)
}

#[tauri::command]
pub fn mcp_remove_config(
    app: AppHandle,
    kind: String,
    registry: State<'_, RegistryState>,
) -> Result<(), String> {
    let connection = connection(&registry)?;
    config::remove(&connection, &kind)?;
    let _ = app.emit("mcp-state-changed", ());
    Ok(())
}

#[tauri::command]
pub fn mcp_set_client_access(
    app: AppHandle,
    client_id: String,
    enabled: bool,
    capability: Capability,
    registry: State<'_, RegistryState>,
) -> Result<(), String> {
    let connection = connection(&registry)?;
    clients::set_access(&connection, &client_id, enabled, capability)?;
    let _ = app.emit("mcp-state-changed", ());
    Ok(())
}

#[tauri::command]
pub fn mcp_list_policies(registry: State<'_, RegistryState>) -> Result<Vec<McpPolicy>, String> {
    let connection = connection(&registry)?;
    policies::list(&connection)
}

#[tauri::command]
pub fn mcp_upsert_policy(
    app: AppHandle,
    input: PolicyInput,
    registry: State<'_, RegistryState>,
) -> Result<McpPolicy, String> {
    let connection = connection(&registry)?;
    let policy = policies::upsert(&connection, input)?;
    let _ = app.emit("mcp-state-changed", ());
    Ok(policy)
}

#[tauri::command]
pub fn mcp_list_activity(
    query: ActivityQuery,
    registry: State<'_, RegistryState>,
) -> Result<Vec<McpActivity>, String> {
    let connection = connection(&registry)?;
    let settings = policy::safety_settings(&connection)?;
    activity::list(&connection, query).map(|records| redact_activity(records, &settings))
}

#[tauri::command]
pub fn mcp_clear_activity(
    app: AppHandle,
    registry: State<'_, RegistryState>,
) -> Result<(), String> {
    let connection = connection(&registry)?;
    activity::clear(&connection)?;
    let _ = app.emit("mcp-activity-changed", ());
    Ok(())
}

#[tauri::command]
pub fn mcp_export_activity(
    format: String,
    query: ActivityQuery,
    registry: State<'_, RegistryState>,
) -> Result<String, String> {
    let connection = connection(&registry)?;
    let settings = policy::safety_settings(&connection)?;
    let records = redact_activity(activity::list(&connection, query)?, &settings);
    if format == "csv" {
        Ok(activity_csv(&records))
    } else {
        records
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<Vec<_>, _>>()
            .map(|lines| lines.join("\n"))
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn mcp_list_approvals(
    workspace_id: Option<String>,
    registry: State<'_, RegistryState>,
) -> Result<Vec<McpApproval>, String> {
    let connection = connection(&registry)?;
    approvals::list_pending(&connection, workspace_id.as_deref())
}

#[tauri::command]
pub fn mcp_get_draft_for_ui(
    draft_id: String,
    registry: State<'_, RegistryState>,
) -> Result<crate::mcp::types::McpDraft, String> {
    let connection = connection(&registry)?;
    crate::mcp::store::drafts::get(&connection, &draft_id)?.ok_or_else(|| "Draft not found".into())
}

#[tauri::command]
pub fn mcp_decide_approval(
    app: AppHandle,
    approval_id: String,
    decision: String,
    registry: State<'_, RegistryState>,
) -> Result<(), String> {
    let connection = connection(&registry)?;
    let approval = approvals::get(&connection, &approval_id)?.ok_or("Approval not found")?;
    if decision == "allow_session"
        && approval
            .summary
            .get("allowSession")
            .and_then(Value::as_bool)
            != Some(true)
    {
        return Err("This action can only be approved once".into());
    }
    approvals::decide(&connection, &approval_id, &decision)?;
    let has_pending = approvals::list_pending(&connection, approval.workspace_id.as_deref())?
        .into_iter()
        .any(|pending| pending.workspace_id == approval.workspace_id);
    drop(connection);
    if !has_pending {
        if let Some(workspace_id) = approval.workspace_id.as_deref() {
            let _ = windows::release_mcp_approval(&app, workspace_id);
        }
    }
    let _ = app.emit("mcp-approval-changed", ());
    Ok(())
}

#[tauri::command]
pub fn mcp_list_workspace_collections(
    workspace_id: String,
    registry: State<'_, RegistryState>,
) -> Result<Vec<WorkspaceCollectionOption>, String> {
    let connection = connection(&registry)?;
    let record = workspace::workspace(&connection, &workspace_id)?;
    workspace::list_collections(std::path::Path::new(&record.root_path))
}

#[tauri::command]
pub fn mcp_list_workspace_environments(
    workspace_id: String,
    registry: State<'_, RegistryState>,
) -> Result<Vec<WorkspaceEnvironmentOption>, String> {
    let connection = connection(&registry)?;
    let record = workspace::workspace(&connection, &workspace_id)?;
    workspace::list_environment_options(std::path::Path::new(&record.root_path))
}
