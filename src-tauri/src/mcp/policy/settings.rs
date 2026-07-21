use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};

use crate::mcp::types::McpSafetySettings;

const DEFAULT_ACTIVITY_RETENTION_DAYS: i64 = 30;
const DEFAULT_ACTIVITY_MAX_ROWS: i64 = 10_000;

pub fn setting<T: DeserializeOwned>(
    connection: &Connection,
    key: &str,
    default: T,
) -> Result<T, String> {
    let raw = connection
        .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(raw
        .and_then(|value| serde_json::from_str::<T>(&value).ok())
        .unwrap_or(default))
}

pub fn set_setting<T: Serialize>(
    connection: &Connection,
    key: &str,
    value: &T,
) -> Result<(), String> {
    connection.execute("INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,serde_json::to_string(value).map_err(|error| error.to_string())?]).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn setting_bool(connection: &Connection, key: &str, default: bool) -> Result<bool, String> {
    setting(connection, key, default)
}

pub fn set_setting_bool(connection: &Connection, key: &str, value: bool) -> Result<(), String> {
    set_setting(connection, key, &value)
}

pub fn safety_settings(connection: &Connection) -> Result<McpSafetySettings, String> {
    Ok(McpSafetySettings {
        store_body_previews: setting(connection, "mcp.store_body_previews", false)?,
        sensitive_key_patterns: setting(connection, "mcp.sensitive_key_patterns", Vec::new())?,
        trusted_destinations: setting(connection, "mcp.trusted_destinations", Vec::new())?,
        activity_retention_days: setting(
            connection,
            "mcp.activity_retention_days",
            DEFAULT_ACTIVITY_RETENTION_DAYS,
        )?
        .clamp(1, 365),
        activity_max_rows: setting(
            connection,
            "mcp.activity_max_rows",
            DEFAULT_ACTIVITY_MAX_ROWS,
        )?
        .clamp(100, 100_000),
    })
}

pub fn set_safety_settings(
    connection: &Connection,
    settings: &McpSafetySettings,
) -> Result<McpSafetySettings, String> {
    let normalized = McpSafetySettings {
        store_body_previews: settings.store_body_previews,
        sensitive_key_patterns: normalize_list(&settings.sensitive_key_patterns),
        trusted_destinations: normalize_list(&settings.trusted_destinations),
        activity_retention_days: settings.activity_retention_days.clamp(1, 365),
        activity_max_rows: settings.activity_max_rows.clamp(100, 100_000),
    };
    set_setting(
        connection,
        "mcp.store_body_previews",
        &normalized.store_body_previews,
    )?;
    set_setting(
        connection,
        "mcp.sensitive_key_patterns",
        &normalized.sensitive_key_patterns,
    )?;
    set_setting(
        connection,
        "mcp.trusted_destinations",
        &normalized.trusted_destinations,
    )?;
    set_setting(
        connection,
        "mcp.activity_retention_days",
        &normalized.activity_retention_days,
    )?;
    set_setting(
        connection,
        "mcp.activity_max_rows",
        &normalized.activity_max_rows,
    )?;
    Ok(normalized)
}

fn normalize_list(values: &[String]) -> Vec<String> {
    let mut values = values
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}
