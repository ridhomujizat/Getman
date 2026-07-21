use std::collections::HashSet;

use serde_json::Value;

pub(super) fn normalize(request: &mut Value) {
    let Some(object) = request.as_object_mut() else {
        return;
    };
    let keys = object
        .get("pathVariables")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|row| row.get("key").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<HashSet<_>>();
    if keys.is_empty() {
        return;
    }
    let Some(url) = object.get("url").and_then(Value::as_str) else {
        return;
    };
    let suffix_at = url.find(['?', '#']).unwrap_or(url.len());
    let (path, suffix) = url.split_at(suffix_at);
    let normalized = path
        .split('/')
        .map(|segment| {
            let trimmed = segment.trim();
            let name = trimmed
                .strip_prefix("{{")
                .and_then(|value| value.strip_suffix("}}"))
                .map(str::trim);
            name.filter(|name| keys.contains(*name))
                .map_or_else(|| segment.to_owned(), |name| format!(":{name}"))
        })
        .collect::<Vec<_>>()
        .join("/");
    object.insert("url".into(), Value::String(normalized + suffix));
}

#[cfg(test)]
mod tests {
    use super::normalize;
    use serde_json::json;

    #[test]
    fn normalize_should_only_convert_declared_path_variables() {
        let mut request = json!({
            "url":"{{baseUrl}}/qc/template/{{ templateId }}/duplicate?copy={{templateId}}",
            "pathVariables":[{"key":"templateId","value":"42"}]
        });

        normalize(&mut request);

        assert_eq!(
            request["url"],
            "{{baseUrl}}/qc/template/:templateId/duplicate?copy={{templateId}}"
        );
    }
}
