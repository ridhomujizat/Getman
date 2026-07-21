use std::path::Path;

use serde_json::{json, Value};

use crate::{mcp::security, workspace_io::WorkspaceQueueState};

use super::{insert_into_folder, read_json, safe_id, write_json};

pub struct CreateEntityResult {
    pub id: String,
    pub relative_paths: Vec<String>,
}

pub fn create_collection(
    root: &Path,
    name: &str,
    queue: &WorkspaceQueueState,
) -> Result<CreateEntityResult, String> {
    let id = security::new_id("col")?;
    let lock = queue.lock_for(root)?;
    let _guard = lock
        .lock()
        .map_err(|_| "Workspace queue lock poisoned".to_string())?;
    let collection_root = root.join("collections").join(&id);
    write_json(
        &collection_root.join("tree.json"),
        &json!({"schemaVersion":2,"root":[]}),
    )?;
    write_json(
        &collection_root.join("collection.json"),
        &json!({"schemaVersion":2,"id":id,"name":name}),
    )?;
    Ok(CreateEntityResult {
        id: id.clone(),
        relative_paths: vec![
            format!("collections/{id}/collection.json"),
            format!("collections/{id}/tree.json"),
        ],
    })
}

pub fn create_folder(
    root: &Path,
    collection_id: &str,
    parent_folder_id: Option<&str>,
    name: &str,
    queue: &WorkspaceQueueState,
) -> Result<CreateEntityResult, String> {
    safe_id(collection_id)?;
    let id = security::new_id("folder")?;
    let lock = queue.lock_for(root)?;
    let _guard = lock
        .lock()
        .map_err(|_| "Workspace queue lock poisoned".to_string())?;
    let tree_path = root
        .join("collections")
        .join(collection_id)
        .join("tree.json");
    let mut tree = read_json(tree_path.clone())?;
    let root_nodes = tree
        .get_mut("root")
        .and_then(Value::as_array_mut)
        .ok_or("Collection tree is invalid")?;
    let node = json!({"id":id,"type":"folder","name":name,"children":[]});
    if let Some(parent_folder_id) = parent_folder_id {
        safe_id(parent_folder_id)?;
        if !insert_into_folder(root_nodes, parent_folder_id, node) {
            return Err("Parent folder not found".into());
        }
    } else {
        root_nodes.push(node);
    }
    write_json(&tree_path, &tree)?;
    Ok(CreateEntityResult {
        id,
        relative_paths: vec![format!("collections/{collection_id}/tree.json")],
    })
}

#[cfg(test)]
mod tests {
    use super::{create_collection, create_folder};
    use crate::{mcp::workspace::read_json, workspace_io::WorkspaceQueueState};

    #[test]
    fn create_collection_should_write_schema_v2_metadata() {
        let root = std::env::temp_dir().join("tesapi-mcp-create-collection");
        let _ = std::fs::remove_dir_all(&root);
        let created = create_collection(&root, "QC", &WorkspaceQueueState::default()).unwrap();
        let metadata = read_json(
            root.join("collections")
                .join(created.id)
                .join("collection.json"),
        )
        .unwrap();
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(metadata["schemaVersion"], 2);
    }

    #[test]
    fn create_folder_should_append_root_folder() {
        let root = std::env::temp_dir().join("tesapi-mcp-create-folder");
        let _ = std::fs::remove_dir_all(&root);
        let queue = WorkspaceQueueState::default();
        let collection = create_collection(&root, "QC", &queue).unwrap();
        create_folder(&root, &collection.id, None, "Template", &queue).unwrap();
        let tree = read_json(
            root.join("collections")
                .join(collection.id)
                .join("tree.json"),
        )
        .unwrap();
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(tree["root"][0]["name"], "Template");
    }
}
