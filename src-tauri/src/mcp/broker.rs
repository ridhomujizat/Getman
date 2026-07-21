use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[cfg(not(windows))]
use interprocess::local_socket::GenericFilePath;
#[cfg(windows)]
use interprocess::local_socket::GenericNamespaced;
use interprocess::local_socket::{
    tokio::{prelude::*, Stream},
    ListenerOptions,
};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

#[cfg(windows)]
use crate::mcp::security;
use crate::{
    db::RegistryState,
    mcp::{
        policy,
        store::clients,
        tools,
        types::{BrokerRequest, BrokerResponse},
    },
    storage,
};

const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

type RateLimiter = Arc<Mutex<HashMap<String, VecDeque<Instant>>>>;

pub struct BrokerState {
    endpoint: String,
    available: Arc<AtomicBool>,
    _limiter: RateLimiter,
}

impl BrokerState {
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
    pub fn available(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }
}

pub fn start(app: &AppHandle) -> Result<BrokerState, String> {
    let endpoint = endpoint(app)?;
    let available = Arc::new(AtomicBool::new(false));
    let limiter = Arc::new(Mutex::new(HashMap::new()));
    let task_endpoint = endpoint.clone();
    let task_available = available.clone();
    let task_app = app.clone();
    let task_limiter = limiter.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(
            task_app,
            &task_endpoint,
            task_available.clone(),
            task_limiter,
        )
        .await
        {
            eprintln!("TesAPI MCP broker stopped: {error}");
            task_available.store(false, Ordering::Relaxed);
        }
    });
    Ok(BrokerState {
        endpoint,
        available,
        _limiter: limiter,
    })
}

async fn run(
    app: AppHandle,
    endpoint: &str,
    available: Arc<AtomicBool>,
    limiter: RateLimiter,
) -> Result<(), String> {
    let listener = listener(endpoint)?;
    set_socket_permissions(endpoint)?;
    available.store(true, Ordering::Relaxed);
    loop {
        let stream = listener.accept().await.map_err(|error| error.to_string())?;
        let app = app.clone();
        let limiter = limiter.clone();
        tokio::spawn(async move {
            if let Err(error) = handle(app, stream, limiter).await {
                eprintln!("TesAPI MCP connection failed: {error}");
            }
        });
    }
}

async fn handle(app: AppHandle, stream: Stream, limiter: RateLimiter) -> Result<(), String> {
    let mut bytes = Vec::new();
    let mut reader = BufReader::new(&stream).take((MAX_MESSAGE_BYTES + 1) as u64);
    reader
        .read_until(b'\n', &mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    let request_id = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|value| {
            value
                .get("requestId")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_default();
    let response = if bytes.len() > MAX_MESSAGE_BYTES {
        BrokerResponse {
            request_id,
            ok: false,
            result: None,
            error_code: Some("INPUT_LIMIT".into()),
            error_message: Some("MCP broker message exceeds 1 MiB".into()),
            session_id: None,
        }
    } else {
        match serde_json::from_slice::<BrokerRequest>(&bytes) {
            Ok(request) if rate_allowed(&limiter, &request.client_id) => {
                dispatch(&app, request).await
            }
            Ok(request) => error(
                &request.request_id,
                "RATE_LIMITED",
                "Too many MCP calls from this client",
            ),
            Err(error) => BrokerResponse {
                request_id,
                ok: false,
                result: None,
                error_code: Some("INVALID_REQUEST".into()),
                error_message: Some(error.to_string()),
                session_id: None,
            },
        }
    };
    let line = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    let mut writer = &stream;
    writer
        .write_all(&line)
        .await
        .map_err(|error| error.to_string())?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    writer.shutdown().await.map_err(|error| error.to_string())
}

async fn dispatch(app: &AppHandle, request: BrokerRequest) -> BrokerResponse {
    let session = {
        let state = app.state::<RegistryState>();
        let connection = match state.0.lock() {
            Ok(connection) => connection,
            Err(_) => {
                return error(
                    &request.request_id,
                    "INTERNAL_ERROR",
                    "Registry database lock poisoned",
                )
            }
        };
        if !policy::setting_bool(&connection, "mcp.enabled", false).unwrap_or(false) {
            return error(
                &request.request_id,
                "MCP_DISABLED",
                "TesAPI MCP Server is disabled",
            );
        }
        match clients::authenticate(
            &connection,
            &request.client_id,
            &request.token,
            request.protocol_version.as_deref().unwrap_or("unknown"),
            request.session_id.as_deref(),
        ) {
            Ok(session) => session,
            Err(message) => return error(&request.request_id, "AUTHENTICATION_FAILED", &message),
        }
    };
    if request.action == "hello" {
        return BrokerResponse {
            request_id: request.request_id,
            ok: true,
            result: Some(serde_json::json!({"client":session.client.display_name})),
            error_code: None,
            error_message: None,
            session_id: Some(session.id),
        };
    }
    let Some(tool_name) = request.tool_name.as_deref() else {
        return error(
            &request.request_id,
            "INVALID_REQUEST",
            "toolName is required",
        );
    };
    match tools::call(app, &session, tool_name, request.arguments).await {
        Ok(result) => BrokerResponse {
            request_id: request.request_id,
            ok: true,
            result: Some(result),
            error_code: None,
            error_message: None,
            session_id: Some(session.id),
        },
        Err(tool_error) => BrokerResponse {
            request_id: request.request_id,
            ok: false,
            result: None,
            error_code: Some(tool_error.code),
            error_message: Some(tool_error.message),
            session_id: Some(session.id),
        },
    }
}

fn endpoint(app: &AppHandle) -> Result<String, String> {
    #[cfg(windows)]
    {
        Ok(format!(
            "tesapi-mcp-{}",
            &security::hash(&std::env::var("USERPROFILE").unwrap_or_default())[..16]
        ))
    }
    #[cfg(not(windows))]
    {
        Ok(storage::resolve(app, "mcp.sock")?
            .to_string_lossy()
            .into_owned())
    }
}

fn listener(endpoint: &str) -> Result<interprocess::local_socket::tokio::Listener, String> {
    #[cfg(windows)]
    let name = endpoint
        .to_ns_name::<GenericNamespaced>()
        .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    let name = endpoint
        .to_fs_name::<GenericFilePath>()
        .map_err(|error| error.to_string())?;
    ListenerOptions::new()
        .name(name)
        .try_overwrite(true)
        .create_tokio()
        .map_err(|error| error.to_string())
}

#[cfg(unix)]
fn set_socket_permissions(endpoint: &str) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(PathBuf::from(endpoint), fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn set_socket_permissions(_endpoint: &str) -> Result<(), String> {
    Ok(())
}

fn error(request_id: &str, code: &str, message: &str) -> BrokerResponse {
    BrokerResponse {
        request_id: request_id.into(),
        ok: false,
        result: None,
        error_code: Some(code.into()),
        error_message: Some(message.into()),
        session_id: None,
    }
}

fn rate_allowed(limiter: &RateLimiter, client_id: &str) -> bool {
    let Ok(mut limiter) = limiter.lock() else {
        return false;
    };
    let calls = limiter.entry(client_id.to_owned()).or_default();
    let cutoff = Instant::now() - Duration::from_secs(60);
    while calls.front().is_some_and(|time| *time < cutoff) {
        calls.pop_front();
    }
    if calls.len() >= 120 {
        return false;
    }
    calls.push_back(Instant::now());
    true
}
