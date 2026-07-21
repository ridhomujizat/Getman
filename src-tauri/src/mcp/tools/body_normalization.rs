use serde_json::Value;

pub(super) fn normalize(body: &mut Value) {
    let Some(object) = body.as_object_mut() else {
        return;
    };
    let current = object.get("type").and_then(Value::as_str).unwrap_or("none");
    if matches!(
        current,
        "json" | "text" | "form-data" | "x-www-form-urlencoded"
    ) {
        return;
    }
    let has_form_data = object
        .get("formData")
        .and_then(Value::as_array)
        .is_some_and(|rows| {
            rows.iter().any(|row| {
                row.get("enabled").and_then(Value::as_bool) != Some(false)
                    && row
                        .get("key")
                        .and_then(Value::as_str)
                        .is_some_and(|key| !key.is_empty())
            })
        });
    let raw = object
        .get("raw")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let inferred = if has_form_data {
        "form-data"
    } else if raw.is_empty() {
        "none"
    } else if serde_json::from_str::<Value>(raw).is_ok() {
        "json"
    } else {
        "text"
    };
    object.insert("type".into(), Value::String(inferred.into()));
}

#[cfg(test)]
mod tests {
    use super::normalize;
    use serde_json::json;

    #[test]
    fn normalize_should_infer_json_body_type() {
        let mut body = json!({"raw":"{\"name\":\"copy\"}"});
        normalize(&mut body);
        assert_eq!(body["type"], "json");
    }

    #[test]
    fn normalize_should_preserve_explicit_text_body_type() {
        let mut body = json!({"type":"text","raw":"{not json}"});
        normalize(&mut body);
        assert_eq!(body["type"], "text");
    }
}
