use serde_json::{Map, Value};

use super::body_normalization;

pub(super) fn normalize(request: &mut Value) {
    let Some(object) = request.as_object_mut() else {
        return;
    };
    for field in ["params", "pathVariables", "headers"] {
        if let Some(rows) = object.get_mut(field) {
            normalize_rows(rows);
        }
    }
    if let Some(body) = object.get_mut("body") {
        body_normalization::normalize(body);
        if let Some(form_data) = body
            .as_object_mut()
            .and_then(|body| body.get_mut("formData"))
        {
            normalize_rows(form_data);
        }
    }
}

fn normalize_rows(value: &mut Value) {
    let Some(rows) = value.as_array_mut() else {
        return;
    };
    for (index, row) in rows.iter_mut().enumerate() {
        let Some(object) = row.as_object_mut() else {
            continue;
        };
        object
            .entry("id")
            .or_insert_with(|| Value::String(format!("mcp-row-{}", index + 1)));
        object
            .entry("key")
            .or_insert_with(|| Value::String(String::new()));
        object
            .entry("value")
            .or_insert_with(|| Value::String(String::new()));
        if !object.contains_key("enabled") {
            object.insert("enabled".into(), Value::Bool(row_has_content(object)));
        }
    }
}

fn row_has_content(row: &Map<String, Value>) -> bool {
    row.get("key")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
        || row
            .get("value")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
        || row
            .get("description")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
        || row.get("valueType").and_then(Value::as_str) == Some("file")
        || row
            .get("files")
            .and_then(Value::as_array)
            .is_some_and(|files| !files.is_empty())
}

#[cfg(test)]
mod tests {
    use super::normalize;
    use serde_json::json;

    #[test]
    fn normalize_should_enable_populated_params_and_assign_id() {
        let mut request = json!({
            "params":[{"key":"page","value":"1"}],
            "headers":[],
            "body":{"type":"none"}
        });
        normalize(&mut request);
        assert_eq!(request["params"][0]["enabled"], true);
        assert_eq!(request["params"][0]["id"], "mcp-row-1");
    }

    #[test]
    fn normalize_should_keep_blank_rows_disabled() {
        let mut request = json!({
            "params":[{"key":"","value":""}],
            "headers":[],
            "body":{"type":"none"}
        });
        normalize(&mut request);
        assert_eq!(request["params"][0]["enabled"], false);
    }
}
