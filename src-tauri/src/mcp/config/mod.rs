mod codex;
mod json;
mod specs;
mod target;

use std::{
    env,
    path::{Path, PathBuf},
};

use rusqlite::Connection;

use specs::{find_in_path, install_locations, spec, specs};

use crate::mcp::{
    security,
    store::clients,
    types::{ClientOverview, ConfigPreview, McpClient},
};

pub fn overview(connection: &Connection, endpoint: &str) -> Result<Vec<ClientOverview>, String> {
    let managed = clients::list(connection)?;
    let command = companion_path()?.to_string_lossy().into_owned();
    Ok(specs()
        .into_iter()
        .map(|spec| {
            let path = spec
                .path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned());
            let client = managed
                .iter()
                .find(|client| client.kind == spec.kind && client.config_path == path)
                .cloned();
            let detected = spec.kind == "manual"
                || spec
                    .executables
                    .iter()
                    .any(|name| find_in_path(name).is_some())
                || install_locations(spec.kind)
                    .iter()
                    .any(|path| path.exists())
                || spec.path.as_ref().is_some_and(|path| path.exists());
            let configuration_status = match spec.path.as_ref() {
                None => "managed_manually".into(),
                Some(path) if !path.exists() => "not_configured".into(),
                Some(path) => match entry_exists(spec.kind, path) {
                    Ok(true) => match client.as_ref() {
                        Some(client)
                            if entry_current(spec.kind, path, &command, endpoint, &client.id)
                                .unwrap_or(false) =>
                        {
                            "configured".into()
                        }
                        Some(_) => "outdated".into(),
                        None => "managed_manually".into(),
                    },
                    Ok(false) => "not_configured".into(),
                    Err(_) => "invalid".into(),
                },
            };
            ClientOverview {
                kind: spec.kind.into(),
                display_name: spec.display.into(),
                detected,
                installation_status: if detected {
                    "detected".into()
                } else {
                    "not_detected".into()
                },
                configuration_status,
                config_path: path,
                client,
            }
        })
        .collect())
}

pub fn preview(kind: &str, endpoint: &str) -> Result<ConfigPreview, String> {
    let spec = spec(kind)?;
    let command = companion_path()?.to_string_lossy().into_owned();
    let path = spec
        .path
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Manual configuration".into());
    let args = vec![
        "--client-id".into(),
        "<generated-on-install>".into(),
        "--token".into(),
        "<generated-on-install>".into(),
        "--endpoint".into(),
        endpoint.into(),
    ];
    let snippet = snippet(kind, &command, &args)?;
    Ok(ConfigPreview {
        kind: kind.into(),
        display_name: spec.display.into(),
        target_path: path,
        operation: if spec.path.as_ref().is_some_and(|path| path.exists()) {
            "patch".into()
        } else {
            "create".into()
        },
        command,
        args,
        snippet,
        preserves_existing: true,
        backup_required: spec.path.as_ref().is_some_and(|path| path.exists()),
    })
}

pub fn install(connection: &Connection, kind: &str, endpoint: &str) -> Result<McpClient, String> {
    let spec = spec(kind)?;
    let path = spec
        .path
        .as_ref()
        .ok_or("Manual configuration cannot be installed automatically")?;
    validate_target(path)?;
    let token = security::random_token()?;
    let path_text = path.to_string_lossy().into_owned();
    let client = clients::upsert(connection, kind, spec.display, Some(&path_text), &token)?;
    let command = companion_path()?.to_string_lossy().into_owned();
    let args = vec![
        "--client-id".into(),
        client.id.clone(),
        "--token".into(),
        token,
        "--endpoint".into(),
        endpoint.into(),
    ];
    let result = patch_entry(kind, path, &command, &args);
    if let Err(error) = result {
        let _ = clients::set_access(
            connection,
            &client.id,
            false,
            crate::mcp::types::Capability::Deny,
        );
        return Err(error);
    }
    Ok(client)
}

pub fn generate_manual(
    connection: &Connection,
    format_kind: &str,
    endpoint: &str,
) -> Result<ConfigPreview, String> {
    let spec = spec(format_kind)?;
    let token = security::random_token()?;
    let client = clients::upsert(
        connection,
        "manual",
        &format!("{} (manual)", spec.display),
        None,
        &token,
    )?;
    let command = companion_path()?.to_string_lossy().into_owned();
    let args = vec![
        "--client-id".into(),
        client.id,
        "--token".into(),
        token,
        "--endpoint".into(),
        endpoint.into(),
    ];
    Ok(ConfigPreview {
        kind: format_kind.into(),
        display_name: spec.display.into(),
        target_path: "Your MCP client configuration".into(),
        operation: "generated".into(),
        snippet: snippet(format_kind, &command, &args)?,
        command,
        args,
        preserves_existing: true,
        backup_required: false,
    })
}

pub fn remove(connection: &Connection, kind: &str) -> Result<(), String> {
    let spec = spec(kind)?;
    let Some(path) = spec.path.as_ref() else {
        return Ok(());
    };
    if path.exists() {
        remove_entry(kind, path)?;
    }
    let path_text = path.to_string_lossy();
    if let Some(client) = clients::list(connection)?.into_iter().find(|client| {
        client.kind == kind && client.config_path.as_deref() == Some(path_text.as_ref())
    }) {
        clients::remove(connection, &client.id)?;
    }
    Ok(())
}

fn entry_exists(kind: &str, path: &Path) -> Result<bool, String> {
    if kind == "codex" {
        codex::entry_exists(path)
    } else {
        json::entry_exists(path)
    }
}
fn entry_current(
    kind: &str,
    path: &Path,
    command: &str,
    endpoint: &str,
    client_id: &str,
) -> Result<bool, String> {
    if kind == "codex" {
        codex::entry_current(path, command, endpoint, client_id)
    } else {
        json::entry_current(path, command, endpoint, client_id)
    }
}
fn patch_entry(kind: &str, path: &Path, command: &str, args: &[String]) -> Result<(), String> {
    let backup = target::backup(path)?;
    let result = if kind == "codex" {
        codex::patch(path, command, args)
    } else {
        json::patch(path, command, args)
    }
    .and_then(|_| {
        entry_exists(kind, path).and_then(|exists| {
            exists
                .then_some(())
                .ok_or_else(|| "TesAPI configuration entry was not written".into())
        })
    });
    if let Err(error) = result {
        target::restore(path, backup.as_deref())?;
        return Err(format!("{error}. The previous configuration was restored."));
    }
    Ok(())
}
fn remove_entry(kind: &str, path: &Path) -> Result<(), String> {
    target::validate(path)?;
    let backup = target::backup(path)?;
    let result = if kind == "codex" {
        codex::remove(path)
    } else {
        json::remove(path)
    }
    .and_then(|_| {
        entry_exists(kind, path).and_then(|exists| {
            (!exists)
                .then_some(())
                .ok_or_else(|| "TesAPI configuration entry was not removed".into())
        })
    });
    if let Err(error) = result {
        target::restore(path, backup.as_deref())?;
        return Err(format!("{error}. The previous configuration was restored."));
    }
    Ok(())
}
fn snippet(kind: &str, command: &str, args: &[String]) -> Result<String, String> {
    if kind == "codex" {
        codex::snippet(command, args)
    } else {
        json::snippet(command, args)
    }
}

fn companion_path() -> Result<PathBuf, String> {
    let current = env::current_exe().map_err(|error| error.to_string())?;
    let name = if cfg!(windows) {
        "tesapi-mcp.exe"
    } else {
        "tesapi-mcp"
    };
    Ok(current
        .parent()
        .ok_or("TesAPI executable has no parent")?
        .join(name))
}

fn validate_target(path: &Path) -> Result<(), String> {
    target::validate(path)
}
