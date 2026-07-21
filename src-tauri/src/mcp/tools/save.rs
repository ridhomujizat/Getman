use serde_json::{json, Value};
use tauri::{Emitter, Manager};

use crate::{
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
use super::{approval, integer, text, with_connection, write, ToolContext, ToolError};

pub async fn call(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let draft_id = required(context.arguments, "draftId")?;
    let expected_revision = integer(context.arguments, "revision")
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "revision is required"))?;
    let collection_id = required(context.arguments, "collectionId")?;
    let folder_id = text(context.arguments, "folderId");
    let draft = with_connection(context.app, |connection| drafts::get(connection, draft_id))
        .map_err(internal)?
        .ok_or_else(|| ToolError::new("NOT_FOUND", "Draft not found"))?;
    if draft.revision != expected_revision {
        return Err(ToolError::new("STALE_DRAFT", "Draft revision is stale."));
    }
    let decision = with_connection(context.app, |connection| {
        policy::evaluate(
            connection,
            context.session,
            PolicyContext {
                workspace_id: Some(&draft.workspace_id),
                collection_id: Some(collection_id),
                environment_id: None,
                required: Capability::Draft,
            },
        )
    })
    .map_err(internal)?;
    if !decision.allowed {
        return Err(ToolError::new("ACCESS_DENIED", decision.reasons.join(", ")));
    }

    let name = text(context.arguments, "name")
        .or_else(|| draft.request.get("name").and_then(Value::as_str))
        .unwrap_or("Untitled request");
    let binding = json!({"draftId":draft.id,"revision":draft.revision,"collectionId":collection_id,"folderId":folder_id,"name":name,"request":draft.request});
    let fingerprint = security::fingerprint(&binding);
    let safety = with_connection(context.app, policy::safety_settings).map_err(internal)?;
    let summary = json!({"action":"save","workspaceId":draft.workspace_id,"collectionId":collection_id,"folderId":folder_id,"name":name,"request":redaction::redact_request_with_patterns(&draft.request, &safety.sensitive_key_patterns),"allowSession":false});
    approval::request(
        context,
        Some(&draft.workspace_id),
        &fingerprint,
        &["SAVE_REQUEST".into()],
        &summary,
        false,
    )
    .await?;

    let current = with_connection(context.app, |connection| drafts::get(connection, draft_id))
        .map_err(internal)?
        .ok_or_else(|| ToolError::new("NOT_FOUND", "Draft no longer exists"))?;
    let current_binding = json!({"draftId":current.id,"revision":current.revision,"collectionId":collection_id,"folderId":folder_id,"name":name,"request":current.request});
    if security::fingerprint(&current_binding) != fingerprint {
        return Err(ToolError::new(
            "STALE_DRAFT",
            "Draft changed after approval.",
        ));
    }
    let current_decision = with_connection(context.app, |connection| {
        policy::evaluate(
            connection,
            context.session,
            PolicyContext {
                workspace_id: Some(&current.workspace_id),
                collection_id: Some(collection_id),
                environment_id: None,
                required: Capability::Draft,
            },
        )
    })
    .map_err(internal)?;
    if !current_decision.allowed {
        return Err(ToolError::new(
            "ACCESS_DENIED",
            current_decision.reasons.join(", "),
        ));
    }
    let workspace_record = with_connection(context.app, |connection| {
        workspace::workspace(connection, &current.workspace_id)
    })
    .map_err(internal)?;
    let update_id = if current.origin_collection_id.as_deref() == Some(collection_id) {
        current.origin_request_id.as_deref()
    } else {
        None
    };
    let queue = context.app.state::<WorkspaceQueueState>();
    let saved = workspace::save_draft_request(
        std::path::Path::new(&workspace_record.root_path),
        collection_id,
        folder_id,
        update_id,
        name,
        &current.request,
        &queue,
    )
    .map_err(internal)?;
    let git_warning = write::auto_commit(context, &workspace_record, &saved.relative_paths).await?;
    let _ = context.app.emit("mcp-workspace-saved", json!({"workspaceId":current.workspace_id,"collectionId":collection_id,"folderId":folder_id,"requestId":saved.request_id}));
    Ok(
        json!({"saved":true,"workspaceId":current.workspace_id,"collectionId":collection_id,"requestId":saved.request_id,"gitWarning":git_warning}),
    )
}

fn internal(error: String) -> ToolError {
    ToolError::new("INTERNAL_ERROR", error)
}
