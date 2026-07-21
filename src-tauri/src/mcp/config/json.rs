use std::{fs, path::Path};

use serde_json::{json, Map, Value};

use crate::storage;

pub fn entry_exists(path: &Path) -> Result<bool, String> {
    let value = read(path)?;
    Ok(value
        .get("mcpServers")
        .and_then(Value::as_object)
        .is_some_and(|servers| servers.contains_key("tesapi")))
}

pub fn entry_current(
    path: &Path,
    command: &str,
    endpoint: &str,
    client_id: &str,
) -> Result<bool, String> {
    let value = read(path)?;
    let Some(entry) = value.pointer("/mcpServers/tesapi") else {
        return Ok(false);
    };
    let args = entry
        .get("args")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    Ok(
        entry.get("_tesapiManaged").and_then(Value::as_bool) == Some(true)
            && entry.get("command").and_then(Value::as_str) == Some(command)
            && args.iter().any(|value| value.as_str() == Some(endpoint))
            && args.iter().any(|value| value.as_str() == Some(client_id)),
    )
}

pub fn patch(path: &Path, command: &str, args: &[String]) -> Result<(), String> {
    let mut value = read(path)?;
    let root = value
        .as_object_mut()
        .ok_or("Client configuration root must be a JSON object")?;
    let servers = root
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("mcpServers must be a JSON object")?;
    servers.insert(
        "tesapi".into(),
        json!({"command":command,"args":args,"_tesapiManaged":true}),
    );
    write(path, &value)
}

pub fn remove(path: &Path) -> Result<(), String> {
    let mut value = read(path)?;
    if let Some(servers) = value.get_mut("mcpServers").and_then(Value::as_object_mut) {
        if servers
            .get("tesapi")
            .and_then(|entry| entry.get("_tesapiManaged"))
            .and_then(Value::as_bool)
            != Some(true)
        {
            return Err("The TesAPI entry is managed manually and was not removed".into());
        }
        servers.remove("tesapi");
    }
    write(path, &value)
}

pub fn snippet(command: &str, args: &[String]) -> Result<String, String> {
    serde_json::to_string_pretty(&json!({"mcpServers":{"tesapi":{"command":command,"args":args}}}))
        .map_err(|error| error.to_string())
}

fn read(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&fs::read_to_string(path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Client configuration is invalid JSON: {error}"))
}

fn write(path: &Path, value: &Value) -> Result<(), String> {
    let contents = format!(
        "{}\n",
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?
    );
    storage::atomic_write_at(path, &contents)?;
    read(path).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{patch, remove};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn patch_should_preserve_unrelated_servers() {
        let path = std::env::temp_dir().join(format!(
            "tesapi-mcp-json-{}.json",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(
            &path,
            r#"{"mcpServers":{"other":{"command":"other"}},"theme":"dark"}"#,
        )
        .unwrap();
        patch(&path, "tesapi-mcp", &["--client-id".into(), "x".into()]).unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["mcpServers"]["other"]["command"], "other");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn remove_should_refuse_unmanaged_entry() {
        let path = std::env::temp_dir().join(format!(
            "tesapi-mcp-unmanaged-{}.json",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, r#"{"mcpServers":{"tesapi":{"command":"custom"}}}"#).unwrap();
        assert!(remove(&path).is_err());
        let _ = fs::remove_file(path);
    }
}
