use std::path::Path;

use serde_json::{json, Value};
use tauri::{Emitter, Manager};

use crate::{
    mcp::{
        policy::{self, PolicyContext},
        security,
        types::Capability,
        workspace,
    },
    workspace_io::WorkspaceQueueState,
};

use super::read::required;
use super::{approval, text, with_connection, write, ToolContext, ToolError};

pub async fn call(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    match context.tool_name {
        "tesapi_create_collection" => create_collection(context).await,
        "tesapi_create_folder" => create_folder(context).await,
        _ => Err(ToolError::new("TOOL_NOT_FOUND", "Structure tool not found")),
    }
}

async fn create_collection(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let workspace_id = required(context.arguments, "workspaceId")?;
    let name = required_name(context.arguments)?;
    authorize(context, workspace_id, None)?;
    let binding = json!({"workspaceId":workspace_id,"name":name});
    let fingerprint = security::fingerprint(&binding);
    let summary = json!({"action":"create_collection","workspaceId":workspace_id,"name":name,"allowSession":false});
    approval::request(
        context,
        Some(workspace_id),
        &fingerprint,
        &["CREATE_COLLECTION".into()],
        &summary,
        false,
    )
    .await?;
    authorize(context, workspace_id, None)?;
    let record = with_connection(context.app, |connection| {
        workspace::workspace(connection, workspace_id)
    })
    .map_err(internal)?;
    let created = workspace::create_collection(
        Path::new(&record.root_path),
        name,
        &context.app.state::<WorkspaceQueueState>(),
    )
    .map_err(internal)?;
    let git_warning = write::auto_commit(context, &record, &created.relative_paths).await?;
    let _ = context.app.emit(
        "mcp-workspace-saved",
        json!({"workspaceId":workspace_id,"collectionId":created.id}),
    );
    Ok(
        json!({"created":true,"workspaceId":workspace_id,"collectionId":created.id,"name":name,"gitWarning":git_warning}),
    )
}

async fn create_folder(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let workspace_id = required(context.arguments, "workspaceId")?;
    let collection_id = required(context.arguments, "collectionId")?;
    let parent_folder_id = text(context.arguments, "parentFolderId");
    let name = required_name(context.arguments)?;
    authorize(context, workspace_id, Some(collection_id))?;
    let record = with_connection(context.app, |connection| {
        workspace::workspace(connection, workspace_id)
    })
    .map_err(internal)?;
    if !workspace::list_collections(Path::new(&record.root_path))
        .map_err(internal)?
        .iter()
        .any(|collection| collection.id == collection_id)
    {
        return Err(ToolError::new("NOT_FOUND", "Collection not found"));
    }
    let binding = json!({"workspaceId":workspace_id,"collectionId":collection_id,"parentFolderId":parent_folder_id,"name":name});
    let fingerprint = security::fingerprint(&binding);
    let summary = json!({"action":"create_folder","workspaceId":workspace_id,"collectionId":collection_id,"parentFolderId":parent_folder_id,"name":name,"allowSession":false});
    approval::request(
        context,
        Some(workspace_id),
        &fingerprint,
        &["CREATE_FOLDER".into()],
        &summary,
        false,
    )
    .await?;
    authorize(context, workspace_id, Some(collection_id))?;
    let created = workspace::create_folder(
        Path::new(&record.root_path),
        collection_id,
        parent_folder_id,
        name,
        &context.app.state::<WorkspaceQueueState>(),
    )
    .map_err(internal)?;
    let git_warning = write::auto_commit(context, &record, &created.relative_paths).await?;
    let _ = context.app.emit(
        "mcp-workspace-saved",
        json!({"workspaceId":workspace_id,"collectionId":collection_id,"folderId":created.id}),
    );
    Ok(
        json!({"created":true,"workspaceId":workspace_id,"collectionId":collection_id,"folderId":created.id,"name":name,"gitWarning":git_warning}),
    )
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

fn required_name(arguments: &Value) -> Result<&str, ToolError> {
    let name = required(arguments, "name")?.trim();
    if name.is_empty() || name.len() > 200 {
        return Err(ToolError::new(
            "INVALID_INPUT",
            "name must contain 1 to 200 characters",
        ));
    }
    Ok(name)
}

fn internal(error: String) -> ToolError {
    ToolError::new("INTERNAL_ERROR", error)
}
