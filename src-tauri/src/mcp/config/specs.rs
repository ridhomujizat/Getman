use std::{env, path::PathBuf};

#[derive(Clone)]
pub(super) struct ClientSpec {
    pub kind: &'static str,
    pub display: &'static str,
    pub path: Option<PathBuf>,
    pub executables: &'static [&'static str],
}

pub(super) fn specs() -> Vec<ClientSpec> {
    vec![
        ClientSpec {
            kind: "claude_desktop",
            display: "Claude Desktop",
            path: config_path("claude_desktop"),
            executables: &["claude"],
        },
        ClientSpec {
            kind: "claude_code",
            display: "Claude Code",
            path: config_path("claude_code"),
            executables: &["claude"],
        },
        ClientSpec {
            kind: "codex",
            display: "Codex",
            path: config_path("codex"),
            executables: &["codex"],
        },
        ClientSpec {
            kind: "cursor",
            display: "Cursor",
            path: config_path("cursor"),
            executables: &["cursor"],
        },
        ClientSpec {
            kind: "manual",
            display: "Manual configuration",
            path: None,
            executables: &[],
        },
    ]
}

pub(super) fn spec(kind: &str) -> Result<ClientSpec, String> {
    specs()
        .into_iter()
        .find(|spec| spec.kind == kind)
        .ok_or_else(|| "Unsupported MCP client".into())
}

pub(super) fn find_in_path(name: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .map(|path| {
                path.join(if cfg!(windows) {
                    format!("{name}.exe")
                } else {
                    name.into()
                })
            })
            .find(|path| path.is_file())
    })
}

pub(super) fn install_locations(kind: &str) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        match kind {
            "claude_desktop" => vec!["/Applications/Claude.app".into()],
            "codex" => vec!["/Applications/Codex.app".into()],
            "cursor" => vec!["/Applications/Cursor.app".into()],
            _ => Vec::new(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = kind;
        Vec::new()
    }
}

fn config_path(kind: &str) -> Option<PathBuf> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))?;
    #[cfg(target_os = "macos")]
    let path = match kind {
        "claude_desktop" => {
            home.join("Library/Application Support/Claude/claude_desktop_config.json")
        }
        "claude_code" => home.join(".claude.json"),
        "codex" => home.join(".codex/config.toml"),
        "cursor" => home.join(".cursor/mcp.json"),
        _ => return None,
    };
    #[cfg(target_os = "windows")]
    let path = match kind {
        "claude_desktop" => env::var_os("APPDATA")
            .map(PathBuf::from)?
            .join("Claude/claude_desktop_config.json"),
        "claude_code" => home.join(".claude.json"),
        "codex" => home.join(".codex/config.toml"),
        "cursor" => home.join(".cursor/mcp.json"),
        _ => return None,
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let path = match kind {
        "claude_desktop" => home.join(".config/Claude/claude_desktop_config.json"),
        "claude_code" => home.join(".claude.json"),
        "codex" => home.join(".codex/config.toml"),
        "cursor" => home.join(".cursor/mcp.json"),
        _ => return None,
    };
    Some(path)
}
