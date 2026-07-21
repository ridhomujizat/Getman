use std::{collections::HashMap, path::Path};

use serde_json::{json, Value};

use crate::mcp::types::WorkspaceEnvironmentOption;

use super::read_json;

fn files(root: &Path) -> Result<(Value, Value), String> {
    let shared =
        read_json(root.join("environments.json")).unwrap_or_else(|_| json!({"environments":[]}));
    let local =
        read_json(root.join("environments.local.json")).unwrap_or_else(|_| json!({"values":{}}));
    Ok((shared, local))
}

pub fn list_environment_options(root: &Path) -> Result<Vec<WorkspaceEnvironmentOption>, String> {
    let (shared, _) = files(root)?;
    let mut options = shared
        .get("environments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|environment| {
            let variables = environment
                .get("variables")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or_default();
            WorkspaceEnvironmentOption {
                id: environment
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                name: environment
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Environment")
                    .into(),
                variable_count: variables.len(),
                secret_count: variables
                    .iter()
                    .filter(|variable| {
                        variable.get("secret").and_then(Value::as_bool) != Some(false)
                    })
                    .count(),
            }
        })
        .collect::<Vec<_>>();
    options.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(options)
}

pub fn environment_metadata(root: &Path, environment_id: &str) -> Result<Value, String> {
    let (shared, local) = files(root)?;
    let environment = shared
        .get("environments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(environment_id))
        .ok_or("Environment not found")?;
    let variables = environment.get("variables").and_then(Value::as_array).into_iter().flatten().map(|variable| {
        let secret = variable.get("secret").and_then(Value::as_bool).unwrap_or(true);
        let resolved = if secret {
            let environment_key = format!("{environment_id}/{}", variable.get("id").and_then(Value::as_str).unwrap_or_default());
            local.pointer(&format!("/values/{}", escape_pointer(&environment_key))).and_then(Value::as_str).is_some_and(|value| !value.is_empty())
        } else { variable.get("value").and_then(Value::as_str).is_some_and(|value| !value.is_empty()) };
        json!({"key":variable.get("key"),"description":variable.get("description"),"enabled":variable.get("enabled"),"secret":secret,"resolved":resolved})
    }).collect::<Vec<_>>();
    Ok(json!({"id":environment_id,"name":environment.get("name"),"variables":variables}))
}

pub fn resolve_request(
    root: &Path,
    environment_id: &str,
    request: &Value,
) -> Result<(Value, Vec<String>, Vec<String>), String> {
    let (shared, local) = files(root)?;
    let environment = shared
        .get("environments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(environment_id))
        .ok_or("Environment not found")?;
    let mut values = HashMap::new();
    let mut secrets = Vec::new();
    for variable in environment
        .get("variables")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|variable| variable.get("enabled").and_then(Value::as_bool) != Some(false))
    {
        let key = variable
            .get("key")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if key.is_empty() {
            continue;
        }
        let secret = variable.get("secret").and_then(Value::as_bool) != Some(false);
        let value = if secret {
            let environment_key = format!(
                "{environment_id}/{}",
                variable
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            );
            local
                .pointer(&format!("/values/{}", escape_pointer(&environment_key)))
                .and_then(Value::as_str)
                .unwrap_or_default()
        } else {
            variable
                .get("value")
                .and_then(Value::as_str)
                .unwrap_or_default()
        };
        values.insert(key.to_owned(), value.to_owned());
        if secret && !value.is_empty() {
            secrets.push(value.to_owned());
        }
    }
    let mut unresolved = Vec::new();
    let resolved = resolve_value(request, &values, &mut unresolved);
    unresolved.sort();
    unresolved.dedup();
    Ok((resolved, unresolved, secrets))
}

fn resolve_value(
    value: &Value,
    values: &HashMap<String, String>,
    unresolved: &mut Vec<String>,
) -> Value {
    match value {
        Value::String(text) => Value::String(resolve_text(text, values, unresolved)),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| resolve_value(item, values, unresolved))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), resolve_value(value, values, unresolved)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn resolve_text(
    text: &str,
    values: &HashMap<String, String>,
    unresolved: &mut Vec<String>,
) -> String {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        output.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            output.push_str(&rest[start..]);
            return output;
        };
        let key = after[..end].trim();
        if let Some(value) = values.get(key) {
            output.push_str(value);
        } else {
            unresolved.push(key.into());
            output.push_str(&rest[start..start + end + 4]);
        }
        rest = &after[end + 2..];
    }
    output.push_str(rest);
    output
}

fn escape_pointer(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

#[cfg(test)]
mod tests {
    use super::resolve_text;
    use std::collections::HashMap;

    #[test]
    fn resolve_text_should_match_shared_variable_grammar() {
        let values = HashMap::from([("base_url".into(), "https://example.com".into())]);
        assert_eq!(
            resolve_text("{{ base_url }}/users", &values, &mut Vec::new()),
            "https://example.com/users"
        );
    }
}
