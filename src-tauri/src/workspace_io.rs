use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, TryLockError,
    },
    time::{Duration, Instant},
};

use git2::{ObjectType, Oid};
use serde::Serialize;
use tauri::State;

use crate::storage;

const MISSING_HASH: &str = "missing";

#[derive(Default)]
pub struct WorkspaceQueueState {
    locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    git_cancellations: Arc<Mutex<HashMap<PathBuf, Arc<AtomicBool>>>>,
}

impl WorkspaceQueueState {
    pub fn lock_for(&self, root: &Path) -> Result<Arc<Mutex<()>>, String> {
        let mut locks = self
            .locks
            .lock()
            .map_err(|_| "Workspace queue registry lock poisoned".to_string())?;
        Ok(locks
            .entry(root.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    pub fn git_cancellations(&self) -> Arc<Mutex<HashMap<PathBuf, Arc<AtomicBool>>>> {
        self.git_cancellations.clone()
    }

    fn active_git(&self, root: &Path) -> Result<Option<Arc<AtomicBool>>, String> {
        Ok(self
            .git_cancellations
            .lock()
            .map_err(|_| "Workspace cancellation registry lock poisoned".to_string())?
            .get(root)
            .cloned())
    }

    fn is_busy(&self, root: &Path) -> Result<bool, String> {
        let lock = self.lock_for(root)?;
        let result = match lock.try_lock() {
            Ok(_) => Ok(false),
            Err(TryLockError::WouldBlock) => Ok(true),
            Err(TryLockError::Poisoned(_)) => Err("Workspace queue lock poisoned".into()),
        };
        result
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    contents: Option<String>,
    hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    written: bool,
    hash: String,
}

fn workspace_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("Workspace path must stay inside the workspace".into());
    }
    Ok(root.join(relative))
}

fn bytes_hash(bytes: &[u8]) -> Result<String, String> {
    Oid::hash_object(ObjectType::Blob, bytes)
        .map(|oid| oid.to_string())
        .map_err(|error| error.message().to_owned())
}

fn file_hash(path: &Path) -> Result<String, String> {
    match fs::read(path) {
        Ok(bytes) => bytes_hash(&bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(MISSING_HASH.into()),
        Err(error) => Err(error.to_string()),
    }
}

fn compare_and_swap_write(
    root: &Path,
    relative: &str,
    contents: &str,
    expected_hash: &str,
) -> Result<WriteOutcome, String> {
    let path = workspace_path(root, relative)?;
    let current = file_hash(&path)?;
    if current != expected_hash {
        return Ok(WriteOutcome {
            written: false,
            hash: current,
        });
    }
    storage::atomic_write_at(&path, contents)?;
    Ok(WriteOutcome {
        written: true,
        hash: bytes_hash(contents.as_bytes())?,
    })
}

#[tauri::command]
pub async fn workspace_read_file(
    root_path: String,
    relative_path: String,
    state: State<'_, WorkspaceQueueState>,
) -> Result<FileSnapshot, String> {
    let root = PathBuf::from(root_path);
    let lock = state.lock_for(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Workspace queue lock poisoned".to_string())?;
        let path = workspace_path(&root, &relative_path)?;
        match fs::read_to_string(&path) {
            Ok(contents) => Ok(FileSnapshot {
                hash: bytes_hash(contents.as_bytes())?,
                contents: Some(contents),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileSnapshot {
                contents: None,
                hash: MISSING_HASH.into(),
            }),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn workspace_write_file(
    root_path: String,
    relative_path: String,
    contents: String,
    expected_hash: String,
    state: State<'_, WorkspaceQueueState>,
) -> Result<WriteOutcome, String> {
    let root = PathBuf::from(root_path);
    let lock = state.lock_for(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Workspace queue lock poisoned".to_string())?;
        compare_and_swap_write(&root, &relative_path, &contents, &expected_hash)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{bytes_hash, compare_and_swap_write, WorkspaceQueueState};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn stale_compare_and_swap_does_not_overwrite_external_edit() {
        let root = std::env::temp_dir().join(format!(
            "tesapi-cas-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("request.json");
        fs::write(&path, "base").unwrap();
        let expected = bytes_hash(b"base").unwrap();
        fs::write(&path, "external").unwrap();
        let result = compare_and_swap_write(&root, "request.json", "mine", &expected).unwrap();
        assert!(!result.written);
        assert_eq!(fs::read_to_string(path).unwrap(), "external");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reports_a_locked_workspace_as_busy() {
        let state = WorkspaceQueueState::default();
        let root = std::env::temp_dir().join("tesapi-busy-probe");
        let lock = state.lock_for(&root).unwrap();
        let guard = lock.lock().unwrap();
        assert!(state.is_busy(&root).unwrap());
        drop(guard);
        assert!(!state.is_busy(&root).unwrap());
    }
}

#[tauri::command]
pub async fn workspace_delete_file(
    root_path: String,
    relative_path: String,
    expected_hash: String,
    state: State<'_, WorkspaceQueueState>,
) -> Result<WriteOutcome, String> {
    let root = PathBuf::from(root_path);
    let lock = state.lock_for(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Workspace queue lock poisoned".to_string())?;
        let path = workspace_path(&root, &relative_path)?;
        let current = file_hash(&path)?;
        if current != expected_hash {
            return Ok(WriteOutcome {
                written: false,
                hash: current,
            });
        }
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        Ok(WriteOutcome {
            written: true,
            hash: MISSING_HASH.into(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn workspace_append_line(
    root_path: String,
    relative_path: String,
    line: String,
    state: State<'_, WorkspaceQueueState>,
) -> Result<WriteOutcome, String> {
    let root = PathBuf::from(root_path);
    let lock = state.lock_for(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Workspace queue lock poisoned".to_string())?;
        let path = workspace_path(&root, &relative_path)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        writeln!(file, "{line}").map_err(|error| error.to_string())?;
        file.sync_data().map_err(|error| error.to_string())?;
        Ok(WriteOutcome {
            written: true,
            hash: file_hash(&path)?,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn workspace_flush(
    root_path: String,
    state: State<'_, WorkspaceQueueState>,
) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let lock = state.lock_for(&root)?;
    let cancel = state.active_git(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(cancel) = cancel else {
            let _guard = lock
                .lock()
                .map_err(|_| "Workspace queue lock poisoned".to_string())?;
            return Ok(());
        };
        let started = Instant::now();
        loop {
            match lock.try_lock() {
                Ok(_guard) => return Ok(()),
                Err(TryLockError::Poisoned(_)) => {
                    return Err("Workspace queue lock poisoned".into())
                }
                Err(TryLockError::WouldBlock) if started.elapsed() < Duration::from_secs(10) => {
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(TryLockError::WouldBlock) => {
                    cancel.store(true, Ordering::Relaxed);
                    let _guard = lock
                        .lock()
                        .map_err(|_| "Workspace queue lock poisoned".to_string())?;
                    return Err("Sync incomplete; TesAPI stopped the network operation after 10 seconds. It will retry next launch.".into());
                }
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn workspace_queue_busy(
    root_path: String,
    state: State<'_, WorkspaceQueueState>,
) -> Result<bool, String> {
    state.is_busy(Path::new(&root_path))
}
