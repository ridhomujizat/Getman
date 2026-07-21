use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::db::now;

pub fn validate(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        if ancestor
            .symlink_metadata()
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err("Refusing to modify a symlinked client configuration path".into());
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        validate_unix_metadata(parent)?;
    }
    if path.exists() {
        validate_unix_metadata(path)?;
    }
    Ok(())
}

pub fn backup(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let backup = path.with_extension(format!("{extension}.tesapi-{}.bak", now()));
    fs::copy(path, &backup).map_err(|error| error.to_string())?;
    Ok(Some(backup))
}

pub fn restore(path: &Path, backup: Option<&Path>) -> Result<(), String> {
    if let Some(backup) = backup {
        fs::copy(backup, path).map_err(|error| error.to_string())?;
    } else if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(unix)]
fn validate_unix_metadata(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.mode() & 0o002 != 0 {
        return Err("Refusing to modify configuration in a world-writable location".into());
    }
    // SAFETY: geteuid has no preconditions and only reads process credentials.
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err("Refusing to modify configuration owned by another user".into());
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_unix_metadata(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{backup, restore};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn restore_should_replace_failed_write_with_backup() {
        let path = std::env::temp_dir().join(format!(
            "tesapi-mcp-rollback-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, "before").unwrap();
        let saved = backup(&path).unwrap();
        fs::write(&path, "after").unwrap();
        restore(&path, saved.as_deref()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "before");
        let _ = fs::remove_file(path);
        if let Some(saved) = saved {
            let _ = fs::remove_file(saved);
        }
    }
}
