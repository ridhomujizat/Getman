use std::{fs::OpenOptions, io::Write, path::Path};

use chrono::Utc;
use serde_json::{json, Value};
use tauri::Manager;

use crate::{
    http,
    mcp::{
        policy::{self, PolicyContext},
        redaction, security,
        store::drafts,
        types::Capability,
        workspace,
    },
    workspace_io::WorkspaceQueueState,
};

use super::read::required;
use super::{approval, text, with_connection, ToolContext, ToolError};

struct SourceRequest {
    workspace_id: String,
    collection_id: Option<String>,
    request_id: Option<String>,
    request: Value,
}

pub async fn call(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let environment_id = required(context.arguments, "environmentId")?;
    let source = load_source(context)?;
    let decision = with_connection(context.app, |connection| {
        policy::evaluate(
            connection,
            context.session,
            PolicyContext {
                workspace_id: Some(&source.workspace_id),
                collection_id: source.collection_id.as_deref(),
                environment_id: Some(environment_id),
                required: Capability::Execute,
            },
        )
    })
    .map_err(internal)?;
    if !decision.allowed {
        return Err(ToolError::new("ACCESS_DENIED", decision.reasons.join(", ")));
    }
    let workspace_record = with_connection(context.app, |connection| {
        workspace::workspace(connection, &source.workspace_id)
    })
    .map_err(internal)?;
    let root = Path::new(&workspace_record.root_path);
    let (resolved, unresolved, secrets) =
        workspace::resolve_request(root, environment_id, &source.request).map_err(internal)?;
    if !unresolved.is_empty() {
        return Err(ToolError::new(
            "UNRESOLVED_VARIABLE",
            format!("Unresolved variables: {}", unresolved.join(", ")),
        ));
    }
    let url_text = resolved
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "Request URL is required"))?;
    let url = reqwest::Url::parse(url_text)
        .map_err(|error| ToolError::new("INVALID_INPUT", format!("Invalid URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ToolError::new(
            "DESTINATION_BLOCKED",
            "Only HTTP and HTTPS URLs are allowed.",
        ));
    }
    let private = security::destination_is_private(&url)
        .await
        .map_err(internal)?;
    let safety = with_connection(context.app, policy::safety_settings).map_err(internal)?;
    let trusted_destination = policy::destination_is_trusted(&url, &safety.trusted_destinations);
    let method = resolved
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET");
    let risks = policy::execution_risks(
        method,
        &url,
        decision.environment_class.as_deref(),
        &resolved,
        private,
        trusted_destination,
    );
    let binding =
        json!({"source":source.request,"environmentId":environment_id,"resolved":resolved});
    let fingerprint = security::fingerprint(&binding);
    if policy::requires_approval(context.tool_name, &decision.approval_mode, &risks) {
        let allow_session = !risks.iter().any(|risk| risk == "PRODUCTION_ENVIRONMENT");
        let summary = json!({"action":"execute","workspaceId":source.workspace_id,"collectionId":source.collection_id,"requestId":source.request_id,"method":method,"url":url.as_str(),"environmentId":environment_id,"environmentClass":decision.environment_class,"risks":risks,"request":redaction::redact_request_with_patterns(&source.request, &safety.sensitive_key_patterns),"allowSession":allow_session});
        approval::request(
            context,
            Some(&source.workspace_id),
            &fingerprint,
            &risks,
            &summary,
            allow_session,
        )
        .await?;
    }
    let fresh = load_source(context)?;
    let (fresh_resolved, fresh_unresolved, fresh_secrets) =
        workspace::resolve_request(root, environment_id, &fresh.request).map_err(internal)?;
    if !fresh_unresolved.is_empty() {
        return Err(ToolError::new(
            "UNRESOLVED_VARIABLE",
            "Variables changed after approval.",
        ));
    }
    if security::fingerprint(
        &json!({"source":fresh.request,"environmentId":environment_id,"resolved":fresh_resolved}),
    ) != fingerprint
    {
        return Err(ToolError::new(
            "APPROVAL_STALE",
            "Request changed after approval.",
        ));
    }
    let fresh_decision = with_connection(context.app, |connection| {
        policy::evaluate(
            connection,
            context.session,
            PolicyContext {
                workspace_id: Some(&fresh.workspace_id),
                collection_id: fresh.collection_id.as_deref(),
                environment_id: Some(environment_id),
                required: Capability::Execute,
            },
        )
    })
    .map_err(internal)?;
    if !fresh_decision.allowed {
        return Err(ToolError::new(
            "ACCESS_DENIED",
            fresh_decision.reasons.join(", "),
        ));
    }
    let fresh_url = fresh_resolved
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "Request URL is required"))?;
    let fresh_url = reqwest::Url::parse(fresh_url)
        .map_err(|error| ToolError::new("INVALID_INPUT", format!("Invalid URL: {error}")))?;
    let fresh_private = security::destination_is_private(&fresh_url)
        .await
        .map_err(internal)?;
    let fresh_risks = policy::execution_risks(
        method,
        &fresh_url,
        fresh_decision.environment_class.as_deref(),
        &fresh_resolved,
        fresh_private,
        policy::destination_is_trusted(&fresh_url, &safety.trusted_destinations),
    );
    if fresh_risks != risks {
        return Err(ToolError::new(
            "APPROVAL_STALE",
            "Destination risk changed after approval.",
        ));
    }
    let native: http::TesApiRequest = serde_json::from_value(fresh_resolved)
        .map_err(|error| ToolError::new("INVALID_INPUT", error.to_string()))?;
    let response = http::execute_request(native, false)
        .await
        .map_err(|error| {
            let detail = serde_json::to_string(&error).unwrap_or_else(|_| "Request failed".into());
            ToolError::new("HTTP_ERROR", redaction::scrub(&detail, &fresh_secrets))
        })?;
    append_history(
        root,
        &fresh.request,
        &response,
        context.app.state::<WorkspaceQueueState>(),
    )
    .map_err(internal)?;
    let headers =
        serde_json::to_value(&response.headers).map_err(|error| internal(error.to_string()))?;
    let mut all_secrets = secrets;
    all_secrets.extend(fresh_secrets);
    let safe = redaction::safe_response(
        &headers,
        &response.body,
        &all_secrets,
        &safety.sensitive_key_patterns,
        64 * 1024,
    );
    Ok(
        json!({"status":response.status,"statusText":response.status_text,"durationMs":response.time_ms,"sizeBytes":response.size_bytes,"headers":safe["headers"],"body":safe["body"],"truncated":safe["truncated"]}),
    )
}

fn load_source(context: &ToolContext<'_>) -> Result<SourceRequest, ToolError> {
    if let Some(draft_id) = text(context.arguments, "draftId") {
        let draft = with_connection(context.app, |connection| drafts::get(connection, draft_id))
            .map_err(internal)?
            .ok_or_else(|| ToolError::new("NOT_FOUND", "Draft not found"))?;
        return Ok(SourceRequest {
            workspace_id: draft.workspace_id,
            collection_id: draft.origin_collection_id,
            request_id: draft.origin_request_id,
            request: draft.request,
        });
    }
    let workspace_id = required(context.arguments, "workspaceId")?;
    let collection_id = required(context.arguments, "collectionId")?;
    let request_id = required(context.arguments, "requestId")?;
    let record = with_connection(context.app, |connection| {
        workspace::workspace(connection, workspace_id)
    })
    .map_err(internal)?;
    let value = workspace::get_request_raw(Path::new(&record.root_path), collection_id, request_id)
        .map_err(internal)?;
    Ok(SourceRequest {
        workspace_id: workspace_id.into(),
        collection_id: Some(collection_id.into()),
        request_id: Some(request_id.into()),
        request: value
            .get("request")
            .cloned()
            .ok_or_else(|| ToolError::new("INVALID_INPUT", "Saved request is invalid"))?,
    })
}

fn append_history(
    root: &Path,
    request: &Value,
    response: &http::TesApiResponse,
    queue: tauri::State<'_, WorkspaceQueueState>,
) -> Result<(), String> {
    let lock = queue.lock_for(root)?;
    let _guard = lock
        .lock()
        .map_err(|_| "Workspace queue lock poisoned".to_string())?;
    let entry = json!({"id":security::new_id("history")?,"ts":Utc::now().to_rfc3339(),"method":request.get("method"),"url":request.get("url"),"status":response.status,"durationMs":response.time_ms,"sizeBytes":response.size_bytes,"request":request});
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("history.ndjson"))
        .map_err(|error| error.to_string())?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&entry).map_err(|error| error.to_string())?
    )
    .map_err(|error| error.to_string())?;
    file.sync_data().map_err(|error| error.to_string())
}

fn internal(error: String) -> ToolError {
    ToolError::new("INTERNAL_ERROR", error)
}
