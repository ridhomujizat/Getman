use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::{json, Map, Value};

pub(super) fn definitions() -> Vec<Tool> {
    vec![
        tool(
            "tesapi_list_workspaces",
            "List TesAPI workspaces explicitly allowed for this client.",
            &[],
            true,
            false,
        ),
        tool(
            "tesapi_list_collections",
            "List allowed collections in a workspace.",
            &["workspaceId"],
            true,
            false,
        ),
        tool(
            "tesapi_search_requests",
            "Search allowed saved requests by name, method, URL, or path.",
            &["workspaceId"],
            true,
            false,
        ),
        tool(
            "tesapi_get_collection_documentation",
            "Get derived redacted documentation for an allowed collection.",
            &["workspaceId", "collectionId"],
            true,
            false,
        ),
        tool(
            "tesapi_get_request",
            "Inspect one allowed request template without secret values.",
            &["workspaceId", "collectionId", "requestId"],
            true,
            false,
        ),
        tool(
            "tesapi_list_environments",
            "List allowed environment metadata and variable keys without values.",
            &["workspaceId"],
            true,
            false,
        ),
        tool(
            "tesapi_create_request_draft",
            "Create an unsaved request draft. This does not modify collections.",
            &["workspaceId"],
            false,
            false,
        ),
        tool(
            "tesapi_update_request_draft",
            "Apply a structured patch to a revisioned unsaved draft.",
            &["draftId", "revision", "patch"],
            false,
            false,
        ),
        tool(
            "tesapi_get_request_draft",
            "Inspect a redacted unsaved draft and its revision.",
            &["draftId"],
            true,
            false,
        ),
        tool(
            "tesapi_save_request_draft",
            "Save an approved draft through TesAPI atomic workspace storage.",
            &["draftId", "revision", "collectionId"],
            false,
            false,
        ),
        tool(
            "tesapi_execute_request",
            "Execute an allowed saved request or draft; risky calls require approval.",
            &["environmentId"],
            false,
            true,
        ),
    ]
}

fn tool(
    name: &'static str,
    description: &'static str,
    required: &[&str],
    read_only: bool,
    open_world: bool,
) -> Tool {
    let properties = required
        .iter()
        .map(|key| ((*key).into(), json!({})))
        .collect::<Map<_, _>>();
    let schema = JsonObject::from_iter([
        ("type".into(), Value::String("object".into())),
        ("properties".into(), Value::Object(properties)),
        (
            "required".into(),
            Value::Array(
                required
                    .iter()
                    .map(|key| Value::String((*key).into()))
                    .collect(),
            ),
        ),
        ("additionalProperties".into(), Value::Bool(true)),
    ]);
    Tool::new(name, description, schema).with_annotations(
        ToolAnnotations::new()
            .read_only(read_only)
            .destructive(!read_only)
            .open_world(open_world),
    )
}
