use serde_json::Value;

use super::{redact_request_with_patterns, redact_value_with_patterns, REDACTED};
use crate::mcp::security::is_sensitive_name;

pub(super) fn sensitive_name(name: &str, patterns: &[String]) -> bool {
    if is_sensitive_name(name) {
        return true;
    }
    let normalized = name.to_ascii_lowercase().replace(['-', ' '], "_");
    patterns.iter().any(|pattern| {
        let pattern = pattern.trim().to_ascii_lowercase().replace(['-', ' '], "_");
        !pattern.is_empty()
            && (normalized == pattern
                || normalized.ends_with(&format!("_{pattern}"))
                || normalized.contains(&pattern))
    })
}

pub(super) fn redact_file_contents(value: &mut Value) {
    let Some(rows) = value
        .pointer_mut("/body/formData")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for file in rows
        .iter_mut()
        .filter_map(|row| row.get_mut("files"))
        .filter_map(Value::as_array_mut)
        .flatten()
    {
        if let Some(object) = file.as_object_mut() {
            let size = object
                .get("data")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            object.insert(
                "data".into(),
                serde_json::json!({"omitted": true, "sizeBytes": size}),
            );
        }
    }
}

pub(super) fn redact_key_value_rows(value: &mut Value, patterns: &[String]) {
    match value {
        Value::Object(object) => {
            let key = object
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if sensitive_name(key, patterns) {
                let keep_placeholder = object
                    .get("value")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.contains("{{"));
                if !keep_placeholder && object.contains_key("value") {
                    object.insert("value".into(), Value::String(REDACTED.into()));
                }
                object.insert("secret".into(), Value::Bool(true));
            }
            object
                .values_mut()
                .for_each(|child| redact_key_value_rows(child, patterns));
        }
        Value::Array(items) => items
            .iter_mut()
            .for_each(|child| redact_key_value_rows(child, patterns)),
        _ => {}
    }
}

pub(super) fn redact_request_shapes(value: &mut Value, patterns: &[String]) {
    match value {
        Value::Object(object)
            if object.contains_key("method")
                && object.contains_key("url")
                && object.contains_key("body") =>
        {
            *value = redact_request_with_patterns(value, patterns);
        }
        Value::Object(object) => object
            .values_mut()
            .for_each(|child| redact_request_shapes(child, patterns)),
        Value::Array(items) => items
            .iter_mut()
            .for_each(|child| redact_request_shapes(child, patterns)),
        _ => {}
    }
}

pub(super) fn redact_embedded_json_bodies(value: &mut Value, patterns: &[String]) {
    match value {
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("json") {
                if let Some(raw) = object.get_mut("raw") {
                    let parsed = raw
                        .as_str()
                        .and_then(|text| serde_json::from_str::<Value>(text).ok());
                    if let Some(parsed) = parsed {
                        *raw = Value::String(
                            redact_value_with_patterns(&parsed, &[], patterns).to_string(),
                        );
                    }
                }
            }
            object
                .values_mut()
                .for_each(|child| redact_embedded_json_bodies(child, patterns));
        }
        Value::Array(items) => items
            .iter_mut()
            .for_each(|child| redact_embedded_json_bodies(child, patterns)),
        _ => {}
    }
}

pub(super) fn redact_url_query(value: &mut Value, patterns: &[String]) {
    let Some(url) = value.get("url").and_then(Value::as_str) else {
        return;
    };
    let Ok(mut parsed) = reqwest::Url::parse(url) else {
        return;
    };
    let pairs = parsed
        .query_pairs()
        .map(|(key, value)| {
            let value = if sensitive_name(&key, patterns) {
                REDACTED.into()
            } else {
                value.into_owned()
            };
            (key.into_owned(), value)
        })
        .collect::<Vec<_>>();
    if pairs.is_empty() {
        return;
    }
    parsed.query_pairs_mut().clear().extend_pairs(pairs);
    value["url"] = Value::String(parsed.into());
}

pub(super) fn omit_bodies(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if key.eq_ignore_ascii_case("body") {
                    let size = serde_json::to_vec(child).map_or(0, |bytes| bytes.len());
                    let body_type = child.get("type").cloned();
                    *child = serde_json::json!({"omitted": true, "sizeBytes": size});
                    if let Some(body_type) = body_type {
                        child["type"] = body_type;
                    }
                } else {
                    omit_bodies(child);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(omit_bodies),
        _ => {}
    }
}
