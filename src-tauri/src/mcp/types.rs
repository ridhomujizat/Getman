use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Capability {
    Deny,
    Read,
    Draft,
    Execute,
}

impl Capability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deny => "deny",
            Self::Read => "read",
            Self::Draft => "draft",
            Self::Execute => "execute",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "read" => Self::Read,
            "draft" => Self::Draft,
            "execute" => Self::Execute,
            _ => Self::Deny,
        }
    }

    pub fn allows(self, required: Self) -> bool {
        self.rank() >= required.rank()
    }

    pub fn minimum(self, other: Self) -> Self {
        if self.rank() <= other.rank() {
            self
        } else {
            other
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Deny => 0,
            Self::Read => 1,
            Self::Draft => 2,
            Self::Execute => 3,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClient {
    pub id: String,
    pub kind: String,
    pub display_name: String,
    pub config_path: Option<String>,
    pub enabled: bool,
    pub capability: Capability,
    pub installed_at: Option<i64>,
    pub last_seen_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientOverview {
    pub kind: String,
    pub display_name: String,
    pub detected: bool,
    pub installation_status: String,
    pub configuration_status: String,
    pub config_path: Option<String>,
    pub client: Option<McpClient>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOverview {
    pub enabled: bool,
    pub read_only: bool,
    pub broker_available: bool,
    pub endpoint: String,
    pub clients: Vec<ClientOverview>,
    pub active_sessions: usize,
    pub safety: McpSafetySettings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSafetySettings {
    pub store_body_previews: bool,
    pub sensitive_key_patterns: Vec<String>,
    pub trusted_destinations: Vec<String>,
    pub activity_retention_days: i64,
    pub activity_max_rows: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPolicy {
    pub id: String,
    pub client_id: Option<String>,
    pub workspace_id: Option<String>,
    pub collection_id: Option<String>,
    pub environment_id: Option<String>,
    pub capability: Capability,
    pub environment_class: Option<String>,
    pub environment_use: Option<bool>,
    pub approval_mode: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyInput {
    pub id: Option<String>,
    pub client_id: Option<String>,
    pub workspace_id: Option<String>,
    pub collection_id: Option<String>,
    pub environment_id: Option<String>,
    pub capability: Capability,
    pub environment_class: Option<String>,
    pub environment_use: Option<bool>,
    pub approval_mode: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpActivity {
    pub id: String,
    pub session_id: String,
    pub client_id: String,
    pub client_name: String,
    pub tool_name: String,
    pub workspace_id: Option<String>,
    pub collection_id: Option<String>,
    pub request_id: Option<String>,
    pub draft_id: Option<String>,
    pub status: String,
    pub policy_reasons: Vec<String>,
    pub input_summary: Value,
    pub output_summary: Value,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub approval_id: Option<String>,
    pub approval_decision: Option<String>,
    pub approval_requested_at: Option<i64>,
    pub approval_decided_at: Option<i64>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub duration_ms: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityQuery {
    pub search: Option<String>,
    pub client_id: Option<String>,
    pub tool_name: Option<String>,
    pub workspace_id: Option<String>,
    pub status: Option<String>,
    pub approval_decision: Option<String>,
    pub session_id: Option<String>,
    pub started_after: Option<i64>,
    pub started_before: Option<i64>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpApproval {
    pub id: String,
    pub activity_id: String,
    pub workspace_id: Option<String>,
    pub client_name: String,
    pub tool_name: String,
    pub request_fingerprint: String,
    pub risk_reasons: Vec<String>,
    pub summary: Value,
    pub decision: String,
    pub requested_at: i64,
    pub decided_at: Option<i64>,
    pub expires_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDraft {
    pub id: String,
    pub workspace_id: String,
    pub origin_collection_id: Option<String>,
    pub origin_request_id: Option<String>,
    pub created_by_client_id: String,
    pub created_by_session_id: String,
    pub revision: i64,
    pub request: Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub expires_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerRequest {
    pub request_id: String,
    pub client_id: String,
    pub token: String,
    pub session_id: Option<String>,
    pub action: String,
    pub tool_name: Option<String>,
    #[serde(default)]
    pub arguments: Value,
    pub protocol_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerResponse {
    pub request_id: String,
    pub ok: bool,
    pub result: Option<Value>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedSession {
    pub id: String,
    pub client: McpClient,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPreview {
    pub kind: String,
    pub display_name: String,
    pub target_path: String,
    pub operation: String,
    pub command: String,
    pub args: Vec<String>,
    pub snippet: String,
    pub preserves_existing: bool,
    pub backup_required: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCollectionOption {
    pub id: String,
    pub name: String,
    pub request_count: usize,
    pub folder_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEnvironmentOption {
    pub id: String,
    pub name: String,
    pub variable_count: usize,
    pub secret_count: usize,
}
