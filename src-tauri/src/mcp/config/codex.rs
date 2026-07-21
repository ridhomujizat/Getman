use std::{fs, path::Path};

use toml_edit::{value, Array, DocumentMut, Item, Table};

use crate::storage;

pub fn entry_exists(path: &Path) -> Result<bool, String> {
    Ok(read(path)?
        .get("mcp_servers")
        .and_then(|item| item.get("tesapi"))
        .is_some())
}

pub fn entry_current(
    path: &Path,
    command: &str,
    endpoint: &str,
    client_id: &str,
) -> Result<bool, String> {
    let document = read(path)?;
    let Some(server) = document
        .get("mcp_servers")
        .and_then(|item| item.get("tesapi"))
        .and_then(Item::as_table)
    else {
        return Ok(false);
    };
    let args = server.get("args").and_then(Item::as_array);
    Ok(
        server.get("tesapi_managed").and_then(Item::as_bool) == Some(true)
            && server.get("command").and_then(Item::as_str) == Some(command)
            && args.is_some_and(|args| {
                args.iter().any(|value| value.as_str() == Some(endpoint))
                    && args.iter().any(|value| value.as_str() == Some(client_id))
            }),
    )
}

pub fn patch(path: &Path, command: &str, args: &[String]) -> Result<(), String> {
    let mut document = read(path)?;
    if document.get("mcp_servers").is_none() {
        document["mcp_servers"] = Item::Table(Table::new());
    }
    let mut server = Table::new();
    server["command"] = value(command);
    let mut array = Array::new();
    for arg in args {
        array.push(arg.as_str());
    }
    server["args"] = value(array);
    server["tesapi_managed"] = value(true);
    document["mcp_servers"]["tesapi"] = Item::Table(server);
    write(path, &document)
}

pub fn remove(path: &Path) -> Result<(), String> {
    let mut document = read(path)?;
    if let Some(servers) = document.get_mut("mcp_servers").and_then(Item::as_table_mut) {
        if servers
            .get("tesapi")
            .and_then(Item::as_table)
            .and_then(|table| table.get("tesapi_managed"))
            .and_then(Item::as_bool)
            != Some(true)
        {
            return Err("The TesAPI entry is managed manually and was not removed".into());
        }
        servers.remove("tesapi");
    }
    write(path, &document)
}

pub fn snippet(command: &str, args: &[String]) -> Result<String, String> {
    let mut document = DocumentMut::new();
    let mut server = Table::new();
    server["command"] = value(command);
    let mut array = Array::new();
    for arg in args {
        array.push(arg.as_str());
    }
    server["args"] = value(array);
    document["mcp_servers"]["tesapi"] = Item::Table(server);
    Ok(document.to_string())
}

fn read(path: &Path) -> Result<DocumentMut, String> {
    if !path.exists() {
        return Ok(DocumentMut::new());
    }
    fs::read_to_string(path)
        .map_err(|error| error.to_string())?
        .parse::<DocumentMut>()
        .map_err(|error| format!("Codex configuration is invalid TOML: {error}"))
}

fn write(path: &Path, document: &DocumentMut) -> Result<(), String> {
    storage::atomic_write_at(path, &document.to_string())?;
    read(path).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::patch;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn patch_should_preserve_codex_settings() {
        let path = std::env::temp_dir().join(format!(
            "tesapi-mcp-codex-{}.toml",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(
            &path,
            "model = \"gpt-5\"\n[mcp_servers.other]\ncommand = \"other\"\n",
        )
        .unwrap();
        patch(&path, "tesapi-mcp", &["--client-id".into(), "x".into()]).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.contains("model = \"gpt-5\""));
        assert!(contents.contains("[mcp_servers.other]"));
        let _ = fs::remove_file(path);
    }
}
