pub mod activity;
pub mod approvals;
pub mod clients;
pub mod drafts;
pub mod policies;

use serde_json::Value;

pub fn json(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

pub fn parse_json(value: String) -> Value {
    serde_json::from_str(&value).unwrap_or(Value::Null)
}

pub fn parse_list(value: String) -> Vec<String> {
    serde_json::from_str(&value).unwrap_or_default()
}
