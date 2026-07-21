use serde_json::{json, Value};

use crate::mcp::{
    policy::{self, PolicyContext},
    types::Capability,
    workspace,
};

use super::{integer, text, with_connection, ToolContext, ToolError};

pub fn call(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    match context.tool_name {
        "tesapi_list_workspaces" => list_workspaces(context),
        "tesapi_list_collections" => list_collections(context),
        "tesapi_search_requests" => search_requests(context),
        "tesapi_get_collection_documentation" => collection_documentation(context),
        "tesapi_get_request" => get_request(context),
        "tesapi_list_environments" => list_environments(context),
        _ => Err(ToolError::new("TOOL_NOT_FOUND", "Read tool not found")),
    }
}

fn authorize(
    context: &ToolContext<'_>,
    workspace_id: Option<&str>,
    collection_id: Option<&str>,
) -> Result<(), ToolError> {
    let decision = with_connection(context.app, |connection| {
        policy::evaluate(
            connection,
            context.session,
            PolicyContext {
                workspace_id,
                collection_id,
                environment_id: None,
                required: Capability::Read,
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

fn list_workspaces(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let records = with_connection(context.app, workspace::workspaces).map_err(internal)?;
    let mut output = Vec::new();
    for record in records {
        let capability = with_connection(context.app, |connection| {
            policy::workspace_capability(connection, context.session, &record.id)
        })
        .map_err(internal)?;
        if capability != Capability::Deny {
            output.push(json!({"id":record.id,"name":record.name,"syncType":record.sync_type,"capability":capability.as_str()}));
        }
    }
    Ok(page("workspaces", output, context.arguments, 50))
}

fn list_collections(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let workspace_id = required(context.arguments, "workspaceId")?;
    authorize(context, Some(workspace_id), None)?;
    let record = with_connection(context.app, |connection| {
        workspace::workspace(connection, workspace_id)
    })
    .map_err(internal)?;
    let records =
        workspace::list_collections(std::path::Path::new(&record.root_path)).map_err(internal)?;
    let collections = records
        .into_iter()
        .filter(|collection| authorize(context, Some(workspace_id), Some(&collection.id)).is_ok())
        .map(|collection| serde_json::to_value(collection).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal)?;
    Ok(page("collections", collections, context.arguments, 100))
}

fn search_requests(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let workspace_id = required(context.arguments, "workspaceId")?;
    let collection_filter = text(context.arguments, "collectionId");
    let query = text(context.arguments, "query").unwrap_or_default();
    let record = with_connection(context.app, |connection| {
        workspace::workspace(connection, workspace_id)
    })
    .map_err(internal)?;
    let collections =
        workspace::list_collections(std::path::Path::new(&record.root_path)).map_err(internal)?;
    let mut results = Vec::new();
    for collection in collections
        .into_iter()
        .filter(|collection| collection_filter.is_none_or(|id| collection.id == id))
    {
        if authorize(context, Some(workspace_id), Some(&collection.id)).is_err() {
            continue;
        }
        results.extend(
            workspace::search_requests(
                std::path::Path::new(&record.root_path),
                &collection.id,
                query,
                usize::MAX,
            )
            .map_err(internal)?,
        );
    }
    results.sort_by(|left, right| {
        pagination_key(left, &["collectionId", "path", "name", "requestId"]).cmp(&pagination_key(
            right,
            &["collectionId", "path", "name", "requestId"],
        ))
    });
    Ok(page("requests", results, context.arguments, 50))
}

fn get_request(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let (workspace_id, collection_id, request_id) = request_reference(context.arguments)?;
    authorize(context, Some(workspace_id), Some(collection_id))?;
    let record = with_connection(context.app, |connection| {
        workspace::workspace(connection, workspace_id)
    })
    .map_err(internal)?;
    workspace::get_request(
        std::path::Path::new(&record.root_path),
        collection_id,
        request_id,
    )
    .map_err(internal)
}

fn collection_documentation(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let workspace_id = required(context.arguments, "workspaceId")?;
    let collection_id = required(context.arguments, "collectionId")?;
    authorize(context, Some(workspace_id), Some(collection_id))?;
    let record = with_connection(context.app, |connection| {
        workspace::workspace(connection, workspace_id)
    })
    .map_err(internal)?;
    let mut documentation =
        workspace::collection_documentation(std::path::Path::new(&record.root_path), collection_id)
            .map_err(internal)?;
    let requests = documentation
        .get_mut("requests")
        .and_then(Value::as_array_mut)
        .map(std::mem::take)
        .unwrap_or_default();
    documentation["requestPage"] = page("items", requests, context.arguments, 50);
    documentation
        .as_object_mut()
        .map(|object| object.remove("requests"));
    Ok(documentation)
}

fn list_environments(context: &ToolContext<'_>) -> Result<Value, ToolError> {
    let workspace_id = required(context.arguments, "workspaceId")?;
    authorize(context, Some(workspace_id), None)?;
    let record = with_connection(context.app, |connection| {
        workspace::workspace(connection, workspace_id)
    })
    .map_err(internal)?;
    let options = workspace::list_environment_options(std::path::Path::new(&record.root_path))
        .map_err(internal)?;
    let mut environments = Vec::new();
    for option in options {
        let decision = with_connection(context.app, |connection| {
            policy::evaluate(
                connection,
                context.session,
                PolicyContext {
                    workspace_id: Some(workspace_id),
                    collection_id: None,
                    environment_id: Some(&option.id),
                    required: Capability::Read,
                },
            )
        })
        .map_err(internal)?;
        if decision.allowed {
            let metadata = workspace::environment_metadata(
                std::path::Path::new(&record.root_path),
                &option.id,
            )
            .map_err(internal)?;
            environments
                .push(json!({"classification":decision.environment_class,"environment":metadata}));
        }
    }
    environments.sort_by(|left, right| {
        left.pointer("/environment/name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .cmp(
                &right
                    .pointer("/environment/name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_ascii_lowercase(),
            )
    });
    Ok(page("environments", environments, context.arguments, 100))
}

fn page(key: &str, values: Vec<Value>, arguments: &Value, default_limit: usize) -> Value {
    let total = values.len();
    let offset = integer(arguments, "offset").unwrap_or(0).max(0) as usize;
    let limit = integer(arguments, "limit")
        .unwrap_or(default_limit as i64)
        .clamp(1, 200) as usize;
    let items = values
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    json!({key:items,"offset":offset,"limit":limit,"total":total,"hasMore":offset.saturating_add(limit)<total})
}

fn pagination_key(value: &Value, path: &[&str]) -> String {
    path.iter()
        .map(|key| {
            value
                .get(*key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase()
        })
        .collect::<Vec<_>>()
        .join("\0")
}

pub fn required<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    text(arguments, key)
        .ok_or_else(|| ToolError::new("INVALID_INPUT", format!("{key} is required")))
}

pub fn request_reference(arguments: &Value) -> Result<(&str, &str, &str), ToolError> {
    Ok((
        required(arguments, "workspaceId")?,
        required(arguments, "collectionId")?,
        required(arguments, "requestId")?,
    ))
}

fn internal(error: String) -> ToolError {
    ToolError::new("INTERNAL_ERROR", error)
}

#[cfg(test)]
mod tests {
    use super::page;
    use serde_json::json;

    #[test]
    fn page_should_return_stable_metadata() {
        let result = page(
            "items",
            vec![json!(1), json!(2), json!(3)],
            &json!({"offset":1,"limit":1}),
            50,
        );
        assert_eq!(
            result,
            json!({"items":[2],"offset":1,"limit":1,"total":3,"hasMore":true})
        );
    }
}
