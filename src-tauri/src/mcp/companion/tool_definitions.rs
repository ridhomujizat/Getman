use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::{json, Map, Value};

pub(super) fn definitions() -> Vec<Tool> {
    vec![
        tool(
            "tesapi_list_workspaces",
            "List TesAPI workspaces explicitly allowed for this client.",
            &[("offset", "integer"), ("limit", "integer")],
            &[],
            true,
            false,
        ),
        tool(
            "tesapi_list_collections",
            "List allowed collections in a workspace.",
            &[
                ("workspaceId", "string"),
                ("offset", "integer"),
                ("limit", "integer"),
            ],
            &["workspaceId"],
            true,
            false,
        ),
        tool(
            "tesapi_create_collection",
            "Create an approved collection in a workspace.",
            &[("workspaceId", "string"), ("name", "string")],
            &["workspaceId", "name"],
            false,
            false,
        ),
        tool(
            "tesapi_create_folder",
            "Create an approved folder in a collection, optionally below another folder.",
            &[
                ("workspaceId", "string"),
                ("collectionId", "string"),
                ("parentFolderId", "string"),
                ("name", "string"),
            ],
            &["workspaceId", "collectionId", "name"],
            false,
            false,
        ),
        tool(
            "tesapi_search_requests",
            "Search allowed saved requests by name, method, URL, or path.",
            &[
                ("workspaceId", "string"),
                ("collectionId", "string"),
                ("query", "string"),
                ("offset", "integer"),
                ("limit", "integer"),
            ],
            &["workspaceId"],
            true,
            false,
        ),
        tool(
            "tesapi_get_collection_documentation",
            "Get derived redacted documentation for an allowed collection.",
            &[
                ("workspaceId", "string"),
                ("collectionId", "string"),
                ("offset", "integer"),
                ("limit", "integer"),
            ],
            &["workspaceId", "collectionId"],
            true,
            false,
        ),
        tool(
            "tesapi_get_request",
            "Inspect one allowed request template without secret values.",
            &[
                ("workspaceId", "string"),
                ("collectionId", "string"),
                ("requestId", "string"),
            ],
            &["workspaceId", "collectionId", "requestId"],
            true,
            false,
        ),
        tool(
            "tesapi_list_environments",
            "List allowed environment metadata and variable keys without values.",
            &[
                ("workspaceId", "string"),
                ("offset", "integer"),
                ("limit", "integer"),
            ],
            &["workspaceId"],
            true,
            false,
        ),
        tool(
            "tesapi_create_request_draft",
            "Create an unsaved request draft. Use {{baseUrl}} for environment variables; use :templateId plus pathVariables for path parameters. Set body.type when raw or formData is present. Populated params, headers, pathVariables, and formData rows are enabled automatically when enabled is omitted. This does not modify collections.",
            &[
                ("workspaceId", "string"),
                ("collectionId", "string"),
                ("requestId", "string"),
                ("request", "object"),
            ],
            &["workspaceId"],
            false,
            false,
        ),
        tool(
            "tesapi_update_request_draft",
            "Apply a structured patch to a revisioned unsaved draft. Path parameters use :name plus pathVariables, never {{name}}; body.type must match raw or formData content. Populated rows are enabled automatically when enabled is omitted.",
            &[
                ("draftId", "string"),
                ("revision", "integer"),
                ("patch", "object"),
            ],
            &["draftId", "revision", "patch"],
            false,
            false,
        ),
        tool(
            "tesapi_get_request_draft",
            "Inspect a redacted unsaved draft and its revision.",
            &[("draftId", "string")],
            &["draftId"],
            true,
            false,
        ),
        tool(
            "tesapi_save_request_draft",
            "Save an approved draft through TesAPI atomic workspace storage.",
            &[
                ("draftId", "string"),
                ("revision", "integer"),
                ("collectionId", "string"),
                ("folderId", "string"),
                ("name", "string"),
            ],
            &["draftId", "revision", "collectionId"],
            false,
            false,
        ),
        tool(
            "tesapi_execute_request",
            "Execute an allowed saved request or draft; risky calls require approval.",
            &[
                ("environmentId", "string"),
                ("draftId", "string"),
                ("workspaceId", "string"),
                ("collectionId", "string"),
                ("requestId", "string"),
            ],
            &["environmentId"],
            false,
            true,
        ),
    ]
}

fn tool(
    name: &'static str,
    description: &'static str,
    properties: &[(&str, &str)],
    required: &[&str],
    read_only: bool,
    open_world: bool,
) -> Tool {
    let properties = properties
        .iter()
        .map(|(key, value_type)| ((*key).into(), json!({"type":value_type})))
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

#[cfg(test)]
mod tests {
    use super::definitions;

    #[test]
    fn update_draft_schema_should_type_revision_as_integer() {
        let tools = definitions();
        let tool = tools
            .iter()
            .find(|tool| tool.name == "tesapi_update_request_draft")
            .unwrap();
        assert_eq!(
            tool.input_schema["properties"]["revision"]["type"],
            "integer"
        );
    }
}
