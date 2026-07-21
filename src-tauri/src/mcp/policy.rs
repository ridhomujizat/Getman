mod risk;
mod settings;

pub use risk::{destination_is_trusted, execution_risks, requires_approval};
pub use settings::{safety_settings, set_safety_settings, set_setting_bool, setting, setting_bool};

use rusqlite::Connection;

use super::{
    store::policies,
    types::{AuthenticatedSession, Capability},
};

#[derive(Clone, Debug)]
pub struct PolicyContext<'a> {
    pub workspace_id: Option<&'a str>,
    pub collection_id: Option<&'a str>,
    pub environment_id: Option<&'a str>,
    pub required: Capability,
}

#[derive(Clone, Debug)]
pub struct PolicyDecision {
    pub allowed: bool,
    pub capability: Capability,
    pub reasons: Vec<String>,
    pub approval_mode: String,
    pub environment_class: Option<String>,
}

pub fn evaluate(
    connection: &Connection,
    session: &AuthenticatedSession,
    context: PolicyContext<'_>,
) -> Result<PolicyDecision, String> {
    let enabled = setting_bool(connection, "mcp.enabled", false)?;
    let read_only = setting_bool(connection, "mcp.read_only", true)?;
    let mut reasons = Vec::new();
    if !enabled {
        reasons.push("MCP_DISABLED".into());
    }
    if !session.client.enabled {
        reasons.push("CLIENT_DISABLED".into());
    }
    if read_only && context.required != Capability::Read {
        reasons.push("READ_ONLY_MODE".into());
    }

    let mut effective = session.client.capability;
    if let Some(workspace_id) = context.workspace_id {
        effective = effective.minimum(
            scope_capability(
                connection,
                &session.client.id,
                Some(workspace_id),
                None,
                None,
            )?
            .unwrap_or(Capability::Deny),
        );
    }
    if let Some(collection_id) = context.collection_id {
        effective = effective.minimum(
            scope_capability(
                connection,
                &session.client.id,
                context.workspace_id,
                Some(collection_id),
                None,
            )?
            .unwrap_or(effective),
        );
    }
    let environment_policy = if let Some(environment_id) = context.environment_id {
        let rows = policies::list(connection)?
            .into_iter()
            .filter(|policy| {
                policy
                    .client_id
                    .as_deref()
                    .is_none_or(|value| value == session.client.id)
                    && policy.workspace_id.as_deref() == context.workspace_id
                    && policy.collection_id.as_deref() == context.collection_id
                    && policy.environment_id.as_deref() == Some(environment_id)
            })
            .collect::<Vec<_>>();
        if rows.is_empty()
            || rows
                .iter()
                .any(|policy| policy.environment_use != Some(true))
        {
            reasons.push("ENVIRONMENT_DENIED".into());
        }
        for policy in &rows {
            effective = effective.minimum(policy.capability);
        }
        rows.into_iter().next()
    } else {
        None
    };
    if !effective.allows(context.required) {
        reasons.push("CAPABILITY_DENIED".into());
    }

    Ok(PolicyDecision {
        allowed: reasons.is_empty(),
        capability: effective,
        approval_mode: environment_policy
            .as_ref()
            .and_then(|policy| policy.approval_mode.clone())
            .unwrap_or_else(|| "risky".into()),
        environment_class: environment_policy.and_then(|policy| policy.environment_class),
        reasons,
    })
}

fn scope_capability(
    connection: &Connection,
    client_id: &str,
    workspace_id: Option<&str>,
    collection_id: Option<&str>,
    environment_id: Option<&str>,
) -> Result<Option<Capability>, String> {
    let all = policies::list(connection)?;
    let mut capabilities = all
        .into_iter()
        .filter(|policy| {
            policy
                .client_id
                .as_deref()
                .is_none_or(|value| value == client_id)
                && policy.workspace_id.as_deref() == workspace_id
                && policy.collection_id.as_deref() == collection_id
                && policy.environment_id.as_deref() == environment_id
        })
        .map(|policy| policy.capability);
    Ok(capabilities
        .next()
        .map(|first| capabilities.fold(first, Capability::minimum)))
}

#[cfg(test)]
mod tests {
    use super::{
        destination_is_trusted, evaluate, execution_risks, requires_approval, PolicyContext,
    };
    use crate::mcp::{
        schema,
        types::{AuthenticatedSession, Capability, McpClient},
    };
    use rusqlite::Connection;
    use serde_json::json;

    fn setup() -> (Connection, AuthenticatedSession) {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);")
            .unwrap();
        schema::migrate(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO settings VALUES ('mcp.enabled','true'),('mcp.read_only','false')",
                [],
            )
            .unwrap();
        let client = McpClient {
            id: "client".into(),
            kind: "manual".into(),
            display_name: "Test".into(),
            config_path: None,
            enabled: true,
            capability: Capability::Execute,
            installed_at: None,
            last_seen_at: None,
        };
        (
            connection,
            AuthenticatedSession {
                id: "session".into(),
                client,
            },
        )
    }

    #[test]
    fn unsafe_methods_should_require_approval_by_default() {
        let url = reqwest::Url::parse("https://api.example.com/items").unwrap();
        let risks = execution_risks("DELETE", &url, Some("staging"), &json!({}), false, false);
        assert!(requires_approval("tesapi_execute_request", "risky", &risks));
    }

    #[test]
    fn safe_get_should_not_require_approval_without_risks() {
        assert!(!requires_approval("tesapi_execute_request", "risky", &[]));
    }

    #[test]
    fn trusted_destination_should_accept_host_or_url() {
        let url = reqwest::Url::parse("http://127.0.0.1:8080/users").unwrap();
        assert!(destination_is_trusted(
            &url,
            &["http://127.0.0.1:8080".into()]
        ));
    }

    #[test]
    fn evaluate_should_deny_workspace_without_policy() {
        let (connection, session) = setup();
        let decision = evaluate(
            &connection,
            &session,
            PolicyContext {
                workspace_id: Some("workspace"),
                collection_id: None,
                environment_id: None,
                required: Capability::Read,
            },
        )
        .unwrap();
        assert!(!decision.allowed);
    }

    #[test]
    fn evaluate_should_not_allow_collection_to_exceed_workspace() {
        let (connection, session) = setup();
        connection.execute_batch("INSERT INTO mcp_policies VALUES ('workspace',NULL,'w',NULL,NULL,'read',NULL,NULL,NULL,0,0); INSERT INTO mcp_policies VALUES ('collection',NULL,'w','c',NULL,'execute',NULL,NULL,NULL,0,0);").unwrap();
        let decision = evaluate(
            &connection,
            &session,
            PolicyContext {
                workspace_id: Some("w"),
                collection_id: Some("c"),
                environment_id: None,
                required: Capability::Draft,
            },
        )
        .unwrap();
        assert_eq!(decision.capability, Capability::Read);
    }

    #[test]
    fn evaluate_should_block_drafts_in_read_only_mode() {
        let (connection, session) = setup();
        connection
            .execute(
                "UPDATE settings SET value='true' WHERE key='mcp.read_only'",
                [],
            )
            .unwrap();
        connection.execute_batch("INSERT INTO mcp_policies VALUES ('workspace',NULL,'w',NULL,NULL,'draft',NULL,NULL,NULL,0,0);").unwrap();
        let decision = evaluate(
            &connection,
            &session,
            PolicyContext {
                workspace_id: Some("w"),
                collection_id: None,
                environment_id: None,
                required: Capability::Draft,
            },
        )
        .unwrap();
        assert!(decision.reasons.contains(&"READ_ONLY_MODE".into()));
    }
}
