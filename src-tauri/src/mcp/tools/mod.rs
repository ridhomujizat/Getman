mod approval;
mod drafts;
mod execute;
mod read;
mod save;
mod structure;
mod write;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    db::RegistryState,
    mcp::{policy, redaction, store::activity, types::AuthenticatedSession},
};

#[derive(Debug)]
pub struct ToolError {
    pub code: String,
    pub message: String,
    pub status: &'static str,
}

impl ToolError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        let status = if matches!(
            code,
            "ACCESS_DENIED" | "APPROVAL_DENIED" | "APPROVAL_TIMEOUT"
        ) {
            "denied"
        } else if code == "CANCELLED" {
            "cancelled"
        } else {
            "failed"
        };
        Self {
            code: code.into(),
            message: message.into(),
            status,
        }
    }
}

pub struct ToolContext<'a> {
    pub app: &'a AppHandle,
    pub session: &'a AuthenticatedSession,
    pub activity_id: &'a str,
    pub tool_name: &'a str,
    pub arguments: &'a Value,
}

pub async fn call(
    app: &AppHandle,
    session: &AuthenticatedSession,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, ToolError> {
    let safety = with_connection(app, policy::safety_settings)
        .map_err(|error| ToolError::new("INTERNAL_ERROR", error))?;
    let safe_input = redaction::activity_summary(
        &arguments,
        &safety.sensitive_key_patterns,
        safety.store_body_previews,
    );
    let workspace_id = text(&arguments, "workspaceId");
    let collection_id = text(&arguments, "collectionId");
    let request_id = text(&arguments, "requestId");
    let draft_id = text(&arguments, "draftId");
    let activity_id = with_connection(app, |connection| {
        activity::start(
            connection,
            activity::ActivityStart {
                session_id: &session.id,
                client_id: &session.client.id,
                tool_name,
                workspace_id,
                collection_id,
                request_id,
                draft_id,
                input_summary: &safe_input,
            },
        )
    })
    .map_err(|error| ToolError::new("INTERNAL_ERROR", error))?;
    let context = ToolContext {
        app,
        session,
        activity_id: &activity_id,
        tool_name,
        arguments: &arguments,
    };
    let result = match tool_name {
        "tesapi_list_workspaces"
        | "tesapi_list_collections"
        | "tesapi_search_requests"
        | "tesapi_get_collection_documentation"
        | "tesapi_get_request"
        | "tesapi_list_environments" => read::call(&context),
        "tesapi_create_request_draft"
        | "tesapi_update_request_draft"
        | "tesapi_get_request_draft" => drafts::call(&context),
        "tesapi_create_collection" | "tesapi_create_folder" => structure::call(&context).await,
        "tesapi_save_request_draft" => save::call(&context).await,
        "tesapi_execute_request" => execute::call(&context).await,
        _ => Err(ToolError::new(
            "TOOL_NOT_FOUND",
            format!("Unknown TesAPI tool: {tool_name}"),
        )),
    }
    .map(|output| {
        let redacted =
            redaction::redact_value_with_patterns(&output, &[], &safety.sensitive_key_patterns);
        redaction::limit_output(&redacted, redaction::MAX_TOOL_OUTPUT_BYTES)
    });
    match &result {
        Ok(output) => {
            let safe_output = redaction::activity_summary(
                output,
                &safety.sensitive_key_patterns,
                safety.store_body_previews,
            );
            let _ = with_connection(app, |connection| {
                activity::finish(
                    connection,
                    &activity_id,
                    "completed",
                    &safe_output,
                    None,
                    None,
                )
            });
        }
        Err(error) => {
            let (safe_message, _) =
                redaction::truncate(&redaction::scrub(&error.message, &[]), 8 * 1024);
            if error.code == "ACCESS_DENIED" {
                let reasons = error
                    .message
                    .split(',')
                    .map(|reason| reason.trim().to_owned())
                    .filter(|reason| !reason.is_empty())
                    .collect::<Vec<_>>();
                let _ = with_connection(app, |connection| {
                    activity::set_status(connection, &activity_id, error.status, &reasons)
                });
            }
            let _ = with_connection(app, |connection| {
                activity::finish(
                    connection,
                    &activity_id,
                    error.status,
                    &Value::Null,
                    Some(&error.code),
                    Some(&safe_message),
                )
            });
        }
    }
    let _ = app.emit("mcp-activity-changed", ());
    result
}

pub fn with_connection<T>(
    app: &AppHandle,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<RegistryState>();
    let connection = state
        .0
        .lock()
        .map_err(|_| "Registry database lock poisoned".to_string())?;
    operation(&connection)
}

pub fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

pub fn integer(value: &Value, key: &str) -> Option<i64> {
    match value.get(key)? {
        Value::Number(number) => number.as_i64(),
        Value::String(number) => number.parse().ok(),
        _ => None,
    }
}

pub fn object_value(value: &Value, key: &str) -> Option<Value> {
    match value.get(key)? {
        object @ Value::Object(_) => Some(object.clone()),
        Value::String(object) => serde_json::from_str::<Value>(object)
            .ok()
            .filter(Value::is_object),
        _ => None,
    }
}

#[cfg(test)]
mod argument_tests {
    use serde_json::json;

    #[test]
    fn integer_should_accept_string_encoded_number() {
        assert_eq!(
            super::integer(&json!({"revision":"7"}), "revision"),
            Some(7)
        );
    }

    #[test]
    fn object_value_should_accept_string_encoded_json() {
        assert_eq!(
            super::object_value(&json!({"patch":"{\"method\":\"GET\"}"}), "patch"),
            Some(json!({"method":"GET"}))
        );
    }
}
