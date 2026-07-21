use serde_json::{json, Value};

use crate::mcp::{
    policy::{self, PolicyContext},
    redaction,
    store::drafts,
    types::Capability,
    workspace,
};

use super::read::required;
use super::{
    integer, object_value, path_templates, request_normalization, text, with_connection,
    ToolContext, ToolError,
};

pub fn call(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    match context.tool_name {
        "tesapi_create_request_draft" => create(context),
        "tesapi_update_request_draft" => update(context),
        "tesapi_get_request_draft" => get(context),
        _ => Err(ToolError::new("TOOL_NOT_FOUND", "Draft tool not found")),
    }
}

fn authorize(
    context: &ToolContext<'_>,
    workspace_id: &str,
    collection_id: Option<&str>,
) -> Result<(), ToolError> {
    let decision = with_connection(context.app, |connection| {
        policy::evaluate(
            connection,
            context.session,
            PolicyContext {
                workspace_id: Some(workspace_id),
                collection_id,
                environment_id: None,
                required: Capability::Draft,
            },
        )
    })
    .map_err(internal)?;
    if decision.allowed {
        Ok(())
    } else {
        Err(ToolError::new("ACCESS_DENIED", decision.reasons.join(", ")))
    }
}

fn create(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let workspace_id = required(context.arguments, "workspaceId")?;
    let collection_id = text(context.arguments, "collectionId");
    let request_id = text(context.arguments, "requestId");
    authorize(context, workspace_id, collection_id)?;
    let mut request = if let (Some(collection_id), Some(request_id)) = (collection_id, request_id) {
        let record = with_connection(context.app, |connection| {
            workspace::workspace(connection, workspace_id)
        })
        .map_err(internal)?;
        workspace::get_request_raw(
            std::path::Path::new(&record.root_path),
            collection_id,
            request_id,
        )
        .map_err(internal)?
        .get("request")
        .cloned()
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "Saved request is invalid"))?
    } else if context.arguments.get("request").is_some() {
        object_value(context.arguments, "request")
            .ok_or_else(|| ToolError::new("INVALID_INPUT", "request must be an object"))?
    } else {
        json!({"id":"","name":"Untitled request","method":"GET","url":"","params":[],"headers":[],"body":{"type":"none"},"auth":{"type":"none"}})
    };
    path_templates::normalize(&mut request);
    request_normalization::normalize(&mut request);
    validate_request(&request)?;
    let draft = with_connection(context.app, |connection| {
        drafts::create(
            connection,
            workspace_id,
            collection_id,
            request_id,
            &context.session.client.id,
            &context.session.id,
            &request,
        )
    })
    .map_err(internal)?;
    Ok(draft_output(&draft))
}

fn update(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let draft_id = required(context.arguments, "draftId")?;
    let revision = integer(context.arguments, "revision")
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "revision is required"))?;
    let mut draft = with_connection(context.app, |connection| drafts::get(connection, draft_id))
        .map_err(internal)?
        .ok_or_else(|| ToolError::new("NOT_FOUND", "Draft not found"))?;
    authorize(
        context,
        &draft.workspace_id,
        draft.origin_collection_id.as_deref(),
    )?;
    let patch = object_value(context.arguments, "patch")
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "patch must be an object"))?;
    let patch = patch
        .as_object()
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "patch must be an object"))?;
    let request = draft
        .request
        .as_object_mut()
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "Draft request is invalid"))?;
    for (key, value) in patch {
        if !matches!(
            key.as_str(),
            "name" | "method" | "url" | "params" | "pathVariables" | "headers" | "body" | "auth"
        ) {
            return Err(ToolError::new(
                "INVALID_INPUT",
                format!("Draft field cannot be changed: {key}"),
            ));
        }
        request.insert(key.clone(), value.clone());
    }
    path_templates::normalize(&mut draft.request);
    request_normalization::normalize(&mut draft.request);
    validate_request(&draft.request)?;
    let updated = with_connection(context.app, |connection| {
        drafts::update(connection, draft_id, revision, &draft.request)
    })
    .map_err(|error| {
        if error.starts_with("STALE_DRAFT") {
            ToolError::new("STALE_DRAFT", error)
        } else {
            internal(error)
        }
    })?;
    Ok(draft_output(&updated))
}

fn get(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let draft_id = required(context.arguments, "draftId")?;
    let draft = with_connection(context.app, |connection| drafts::get(connection, draft_id))
        .map_err(internal)?
        .ok_or_else(|| ToolError::new("NOT_FOUND", "Draft not found"))?;
    authorize(
        context,
        &draft.workspace_id,
        draft.origin_collection_id.as_deref(),
    )?;
    Ok(draft_output(&draft))
}

fn draft_output(draft: &crate::mcp::types::McpDraft) -> Value {
    json!({"id":draft.id,"workspaceId":draft.workspace_id,"originCollectionId":draft.origin_collection_id,"originRequestId":draft.origin_request_id,"revision":draft.revision,"request":redaction::redact_request(&draft.request),"updatedAt":draft.updated_at,"expiresAt":draft.expires_at})
}

pub fn validate_request(request: &Value) -> Result<(), ToolError> {
    let object = request
        .as_object()
        .ok_or_else(|| ToolError::new("INVALID_INPUT", "request must be an object"))?;
    for field in ["method", "url", "params", "headers", "body", "auth"] {
        if !object.contains_key(field) {
            return Err(ToolError::new(
                "INVALID_INPUT",
                format!("request.{field} is required"),
            ));
        }
    }
    Ok(())
}

fn internal(error: String) -> ToolError {
    ToolError::new("INTERNAL_ERROR", error)
}
