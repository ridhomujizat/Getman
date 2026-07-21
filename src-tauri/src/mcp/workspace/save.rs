use std::{fs, path::Path};

use serde_json::{json, Value};

use crate::{mcp::security, storage, workspace_io::WorkspaceQueueState};

use super::{read_json, safe_id};

pub struct SaveDraftResult {
    pub request_id: String,
    pub relative_paths: Vec<String>,
}

pub fn save_draft_request(
    root: &Path,
    collection_id: &str,
    folder_id: Option<&str>,
    request_id: Option<&str>,
    name: &str,
    request: &Value,
    queue: &WorkspaceQueueState,
) -> Result<SaveDraftResult, String> {
    safe_id(collection_id)?;
    let collection_root = root.join("collections").join(collection_id);
    let tree_path = collection_root.join("tree.json");
    let mut tree = read_json(tree_path.clone())?;
    let id = request_id
        .map(str::to_owned)
        .unwrap_or(security::new_id("req")?);
    safe_id(&id)?;
    let lock = queue.lock_for(root)?;
    let _guard = lock
        .lock()
        .map_err(|_| "Workspace queue lock poisoned".to_string())?;

    let mut relative_paths = Vec::new();
    if request_id.is_none() {
        let node = json!({"id":id,"type":"request","name":name});
        let root_nodes = tree
            .get_mut("root")
            .and_then(Value::as_array_mut)
            .ok_or("Collection tree is invalid")?;
        if let Some(folder_id) = folder_id {
            if !insert_into_folder(root_nodes, folder_id, node.clone()) {
                return Err("Destination folder not found".into());
            }
        } else {
            root_nodes.push(node);
        }
        write_json(&tree_path, &tree)?;
        relative_paths.push(format!("collections/{collection_id}/tree.json"));
    }
    let request_path = collection_root.join("requests").join(format!("{id}.json"));
    let mut file = if request_path.exists() {
        read_json(request_path.clone())?
    } else {
        json!({"schemaVersion":2,"id":id,"savedResponses":[]})
    };
    file["name"] = Value::String(name.trim().to_owned());
    file["request"] = request.clone();
    write_json(&request_path, &file)?;
    relative_paths.push(format!("collections/{collection_id}/requests/{id}.json"));
    Ok(SaveDraftResult {
        request_id: id,
        relative_paths,
    })
}

fn insert_into_folder(nodes: &mut [Value], folder_id: &str, node: Value) -> bool {
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

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let canonical = security::canonical(value);
    let contents = format!(
        "{}\n",
        serde_json::to_string_pretty(&canonical).map_err(|error| error.to_string())?
    );
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    storage::atomic_write_at(path, &contents)
}
