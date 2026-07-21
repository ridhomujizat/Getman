use std::{fs, path::Path};

use serde_json::{json, Value};

use crate::mcp::{redaction, types::WorkspaceCollectionOption};

use super::{read_json, safe_id};

fn count_nodes(nodes: &[Value]) -> (usize, usize) {
    nodes.iter().fold((0, 0), |(requests, folders), node| {
        if node.get("type").and_then(Value::as_str) == Some("folder") {
            let (child_requests, child_folders) = node
                .get("children")
                .and_then(Value::as_array)
                .map(|children| count_nodes(children))
                .unwrap_or_default();
            (requests + child_requests, folders + child_folders + 1)
        } else {
            (requests + 1, folders)
        }
    })
}

pub fn list_collections(root: &Path) -> Result<Vec<WorkspaceCollectionOption>, String> {
    let directory = root.join("collections");
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let meta = read_json(entry.path().join("collection.json"));
        let tree = read_json(entry.path().join("tree.json"));
        let (Ok(meta), Ok(tree)) = (meta, tree) else {
            continue;
        };
        let nodes = tree
            .get("root")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let (request_count, folder_count) = count_nodes(nodes);
        records.push(WorkspaceCollectionOption {
            id,
            name: meta
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Untitled collection")
                .into(),
            request_count,
            folder_count,
        });
    }
    records.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(records)
}

pub fn insert_into_folder(nodes: &mut [Value], folder_id: &str, node: Value) -> bool {
    for item in nodes {
        if item.get("id").and_then(Value::as_str) == Some(folder_id)
            && item.get("type").and_then(Value::as_str) == Some("folder")
        {
            if let Some(children) = item.get_mut("children").and_then(Value::as_array_mut) {
                children.push(node);
                return true;
            }
        }
        if let Some(children) = item.get_mut("children").and_then(Value::as_array_mut) {
            if insert_into_folder(children, folder_id, node.clone()) {
                return true;
            }
        }
    }
    false
}

fn request_nodes(nodes: &[Value], prefix: &str, output: &mut Vec<(String, String)>) {
    for node in nodes {
        let name = node
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Untitled");
        if node.get("type").and_then(Value::as_str) == Some("folder") {
            let path = if prefix.is_empty() {
                name.into()
            } else {
                format!("{prefix} / {name}")
            };
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                request_nodes(children, &path, output);
            }
        } else if let Some(id) = node.get("id").and_then(Value::as_str) {
            output.push((id.into(), prefix.into()));
        }
    }
}

pub fn get_request(root: &Path, collection_id: &str, request_id: &str) -> Result<Value, String> {
    let mut file = get_request_raw(root, collection_id, request_id)?;
    if let Some(request) = file.get_mut("request") {
        *request = redaction::redact_request(request);
    }
    Ok(file)
}

pub fn get_request_raw(
    root: &Path,
    collection_id: &str,
    request_id: &str,
) -> Result<Value, String> {
    safe_id(collection_id)?;
    safe_id(request_id)?;
    let file = read_json(
        root.join("collections")
            .join(collection_id)
            .join("requests")
            .join(format!("{request_id}.json")),
    )?;
    let request = file
        .get("request")
        .cloned()
        .ok_or("Request file is invalid")?;
    Ok(json!({
        "id": request_id,
        "name": file.get("name").cloned().unwrap_or(Value::String("Untitled request".into())),
        "request": request,
        "savedResponses": file.get("savedResponses").and_then(Value::as_array).map(|responses| responses.iter().map(|response| json!({"id":response.get("id"),"name":response.get("name")})).collect::<Vec<_>>()).unwrap_or_default()
    }))
}

pub fn search_requests(
    root: &Path,
    collection_id: &str,
    search: &str,
    limit: usize,
) -> Result<Vec<Value>, String> {
    safe_id(collection_id)?;
    let tree = read_json(
        root.join("collections")
            .join(collection_id)
            .join("tree.json"),
    )?;
    let mut nodes = Vec::new();
    request_nodes(
        tree.get("root")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default(),
        "",
        &mut nodes,
    );
    let needle = search.to_ascii_lowercase();
    let mut results = Vec::new();
    for (request_id, path) in nodes {
        let request = get_request(root, collection_id, &request_id)?;
        let haystack = format!(
            "{} {} {} {}",
            request["name"].as_str().unwrap_or_default(),
            request
                .pointer("/request/method")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            request
                .pointer("/request/url")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            path
        )
        .to_ascii_lowercase();
        if needle.is_empty() || haystack.contains(&needle) {
            results.push(json!({"collectionId":collection_id,"requestId":request_id,"path":path,"name":request["name"],"method":request.pointer("/request/method"),"url":request.pointer("/request/url")}));
            if results.len() >= limit {
                break;
            }
        }
    }
    Ok(results)
}

pub fn collection_documentation(root: &Path, collection_id: &str) -> Result<Value, String> {
    safe_id(collection_id)?;
    let meta = read_json(
        root.join("collections")
            .join(collection_id)
            .join("collection.json"),
    )?;
    let requests = search_requests(root, collection_id, "", 500)?;
    let details = requests
        .iter()
        .filter_map(|item| item.get("requestId").and_then(Value::as_str))
        .filter_map(|id| get_request(root, collection_id, id).ok())
        .collect::<Vec<_>>();
    Ok(json!({"id":collection_id,"name":meta.get("name"),"requests":details}))
}

#[cfg(test)]
mod tests {
    use super::search_requests;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn search_requests_should_read_spread_request_files() {
        let root = std::env::temp_dir().join(format!(
            "tesapi-mcp-search-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let collection = root.join("collections/c1");
        fs::create_dir_all(collection.join("requests")).unwrap();
        fs::write(
            collection.join("tree.json"),
            r#"{"root":[{"id":"r1","type":"request","name":"List users"}]}"#,
        )
        .unwrap();
        fs::write(collection.join("requests/r1.json"), r#"{"name":"List users","request":{"method":"GET","url":"https://example.com/users","headers":[],"params":[],"body":{"type":"none"},"auth":{"type":"none"}}}"#).unwrap();
        assert_eq!(search_requests(&root, "c1", "users", 10).unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }
}
