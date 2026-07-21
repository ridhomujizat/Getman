mod tool_definitions;

use std::{collections::HashMap, env, sync::Arc};

use interprocess::local_socket::tokio::{prelude::*, Stream};
#[cfg(not(windows))]
use interprocess::local_socket::GenericFilePath;
#[cfg(windows)]
use interprocess::local_socket::GenericNamespaced;
use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, ContentBlock, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    ErrorData as McpError, RoleServer, ServerHandler,
};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::{
    security,
    types::{BrokerRequest, BrokerResponse},
};

#[derive(Clone)]
pub struct CompanionServer {
    client_id: String,
    token: String,
    endpoint: String,
    session_id: String,
    tools: Arc<Vec<Tool>>,
}

impl CompanionServer {
    pub async fn connect(
        client_id: String,
        token: String,
        endpoint: String,
    ) -> Result<Self, String> {
        let hello = BrokerRequest {
            request_id: security::new_id("request")?,
            client_id: client_id.clone(),
            token: token.clone(),
            session_id: None,
            action: "hello".into(),
            tool_name: None,
            arguments: Value::Null,
            protocol_version: Some("2025-11-25".into()),
        };
        let response = send(&endpoint, &hello)
            .await
            .map_err(|error| format!("TesAPI is not running: {error}"))?;
        if !response.ok {
            return Err(response
                .error_message
                .unwrap_or_else(|| "TesAPI authentication failed".into()));
        }
        Ok(Self {
            client_id,
            token,
            endpoint,
            session_id: response
                .session_id
                .ok_or("TesAPI did not create a session")?,
            tools: Arc::new(tool_definitions::definitions()),
        })
    }
}

impl ServerHandler for CompanionServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("tesapi-mcp", env!("CARGO_PKG_VERSION")).with_title("TesAPI MCP Server").with_description("Safely exposes allowed TesAPI API collections to local AI clients."))
            .with_instructions("TesAPI is deny-by-default. Secret values are never returned; saves and risky requests require approval in TesAPI. URL templates use {{name}} only for environment variables, such as {{baseUrl}}. Endpoint path parameters use :name plus a pathVariables row, for example {{baseUrl}}/qc/template/:templateId/duplicate. Never write a path parameter as {{templateId}}. Request bodies should set body.type to json, text, form-data, or x-www-form-urlencoded when raw or formData is present. Params, headers, pathVariables, and formData rows may omit id and enabled; TesAPI assigns an id and enables populated rows automatically.")
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult::with_all_items(self.tools.as_ref().clone()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let broker_request = BrokerRequest {
            request_id: security::new_id("request")
                .map_err(|message| McpError::internal_error(message, None))?,
            client_id: self.client_id.clone(),
            token: self.token.clone(),
            session_id: Some(self.session_id.clone()),
            action: "call".into(),
            tool_name: Some(request.name.into_owned()),
            arguments: Value::Object(request.arguments.unwrap_or_default()),
            protocol_version: Some("2025-11-25".into()),
        };
        match send(&self.endpoint, &broker_request).await {
            Ok(response) if response.ok => Ok(CallToolResult::structured(
                response.result.unwrap_or(Value::Null),
            )),
            Ok(response) => Ok(CallToolResult::error(vec![ContentBlock::text(
                json!({"code":response.error_code,"message":response.error_message}).to_string(),
            )])),
            Err(message) => Ok(CallToolResult::error(vec![ContentBlock::text(
                json!({"code":"TESAPI_UNAVAILABLE","message":message}).to_string(),
            )])),
        }
    }
}

pub fn parse_args() -> Result<(String, String, String), String> {
    let mut values = HashMap::new();
    let mut args = env::args().skip(1);
    while let Some(key) = args.next() {
        if let Some(value) = args.next() {
            values.insert(key, value);
        }
    }
    Ok((
        values
            .remove("--client-id")
            .ok_or("--client-id is required")?,
        values.remove("--token").ok_or("--token is required")?,
        values
            .remove("--endpoint")
            .ok_or("--endpoint is required")?,
    ))
}

async fn send(endpoint: &str, request: &BrokerRequest) -> Result<BrokerResponse, String> {
    let stream = connect(endpoint).await?;
    let line = serde_json::to_vec(request).map_err(|error| error.to_string())?;
    let mut writer = &stream;
    writer
        .write_all(&line)
        .await
        .map_err(|error| error.to_string())?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    writer.flush().await.map_err(|error| error.to_string())?;
    let mut response = String::new();
    BufReader::new(&stream)
        .read_line(&mut response)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&response).map_err(|error| error.to_string())
}

async fn connect(endpoint: &str) -> Result<Stream, String> {
    #[cfg(windows)]
    let name = endpoint
        .to_ns_name::<GenericNamespaced>()
        .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    let name = endpoint
        .to_fs_name::<GenericFilePath>()
        .map_err(|error| error.to_string())?;
    Stream::connect(name)
        .await
        .map_err(|error| error.to_string())
}
