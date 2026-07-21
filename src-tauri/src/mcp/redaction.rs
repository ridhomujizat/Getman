mod helpers;

use serde_json::Value;

use helpers::{
    omit_bodies, redact_embedded_json_bodies, redact_file_contents, redact_key_value_rows,
    redact_request_shapes, redact_url_query, sensitive_name,
};

const REDACTED: &str = "<redacted>";
pub const MAX_TOOL_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_ACTIVITY_SUMMARY_BYTES: usize = 64 * 1024;

pub fn redact_value(value: &Value, known_secrets: &[String]) -> Value {
    redact_value_with_patterns(value, known_secrets, &[])
}

pub fn redact_value_with_patterns(
    value: &Value,
    known_secrets: &[String],
    sensitive_patterns: &[String],
) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let safe = if sensitive_name(key, sensitive_patterns) {
                        Value::String(REDACTED.into())
                    } else {
                        redact_value_with_patterns(value, known_secrets, sensitive_patterns)
                    };
                    (key.clone(), safe)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| redact_value_with_patterns(item, known_secrets, sensitive_patterns))
                .collect(),
        ),
        Value::String(text) => Value::String(scrub(text, known_secrets)),
        _ => value.clone(),
    }
}

pub fn redact_request(value: &Value) -> Value {
    redact_request_with_patterns(value, &[])
}

pub fn redact_request_with_patterns(value: &Value, sensitive_patterns: &[String]) -> Value {
    let mut safe = redact_value_with_patterns(value, &[], sensitive_patterns);
    redact_key_value_rows(&mut safe, sensitive_patterns);
    redact_url_query(&mut safe, sensitive_patterns);
    redact_embedded_json_bodies(&mut safe, sensitive_patterns);
    if let Some(auth) = safe.get_mut("auth").and_then(Value::as_object_mut) {
        for key in ["token", "password", "value"] {
            if auth
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|value| !value.contains("{{"))
            {
                auth.insert(key.into(), Value::String(REDACTED.into()));
            }
        }
    }
    redact_file_contents(&mut safe);
    safe
}

pub fn activity_summary(
    value: &Value,
    sensitive_patterns: &[String],
    store_body_previews: bool,
) -> Value {
    let mut safe = redact_value_with_patterns(value, &[], sensitive_patterns);
    redact_key_value_rows(&mut safe, sensitive_patterns);
    redact_request_shapes(&mut safe, sensitive_patterns);
    redact_embedded_json_bodies(&mut safe, sensitive_patterns);
    redact_file_contents(&mut safe);
    if !store_body_previews {
        omit_bodies(&mut safe);
    }
    limit_output(&safe, MAX_ACTIVITY_SUMMARY_BYTES)
}

pub fn limit_output(value: &Value, max_bytes: usize) -> Value {
    let serialized = serde_json::to_string(value).unwrap_or_default();
    if serialized.len() <= max_bytes {
        return value.clone();
    }
    let (preview, _) = truncate(&serialized, max_bytes.saturating_sub(256));
    serde_json::json!({
        "truncated": true,
        "returnedBytes": preview.len(),
        "totalBytes": serialized.len(),
        "preview": preview,
    })
}

pub fn scrub(text: &str, known_secrets: &[String]) -> String {
    known_secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(text.to_owned(), |safe, secret| {
            safe.replace(secret, REDACTED)
        })
}

pub fn truncate(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_owned(), false);
    }
    let mut boundary = max_bytes;
    while !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    (format!("{}\n<truncated>", &text[..boundary]), true)
}

pub fn safe_response(
    headers: &Value,
    body: &str,
    known_secrets: &[String],
    sensitive_patterns: &[String],
    max_body: usize,
) -> Value {
    let safe_headers = redact_value_with_patterns(headers, known_secrets, sensitive_patterns);
    let scrubbed = scrub(body, known_secrets);
    let (body, truncated) = truncate(&scrubbed, max_body);
    serde_json::json!({ "headers": safe_headers, "body": body, "truncated": truncated })
}

#[cfg(test)]
mod tests {
    use super::{
        activity_summary, limit_output, redact_request, redact_value_with_patterns, scrub, truncate,
    };
    use serde_json::json;

    #[test]
    fn redact_request_should_hide_authorization_header() {
        let safe =
            redact_request(&json!({"headers":[{"key":"Authorization","value":"Bearer abc"}]}));
        assert_eq!(safe["headers"][0]["value"], "<redacted>");
    }

    #[test]
    fn redact_request_should_preserve_secret_placeholder() {
        let safe = redact_request(
            &json!({"headers":[{"key":"Authorization","value":"Bearer {{ token }}"}]}),
        );
        assert_eq!(safe["headers"][0]["value"], "Bearer {{ token }}");
    }

    #[test]
    fn scrub_should_remove_known_secret_from_error() {
        assert_eq!(
            scrub("failed token-123", &["token-123".into()]),
            "failed <redacted>"
        );
    }

    #[test]
    fn truncate_should_keep_valid_utf8() {
        assert_eq!(
            truncate("TesAPI-✓", 8),
            ("TesAPI-\n<truncated>".into(), true)
        );
    }

    #[test]
    fn custom_pattern_should_redact_matching_keys() {
        let safe = redact_value_with_patterns(
            &json!({"customerPin":"1234","name":"Ridho"}),
            &[],
            &["pin".into()],
        );
        assert_eq!(safe["customerPin"], "<redacted>");
    }

    #[test]
    fn request_should_redact_sensitive_query_and_param_rows() {
        let safe = redact_request(&json!({
            "url":"https://example.com/users?token=abc&limit=10",
            "params":[{"key":"api_key","value":"abc"}]
        }));
        assert!(safe["url"].as_str().unwrap().contains("%3Credacted%3E"));
        assert_eq!(safe["params"][0]["value"], "<redacted>");
    }

    #[test]
    fn activity_should_omit_bodies_by_default() {
        let safe = activity_summary(&json!({"body":"secret response"}), &[], false);
        assert_eq!(safe["body"]["omitted"], true);
    }

    #[test]
    fn total_limit_should_report_truncation() {
        let safe = limit_output(&json!({"value":"x".repeat(1_000)}), 256);
        assert_eq!(safe["truncated"], true);
        assert!(safe["totalBytes"].as_u64().unwrap() > 256);
    }
}
