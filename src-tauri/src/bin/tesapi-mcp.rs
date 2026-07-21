use rmcp::ServiceExt;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("TesAPI MCP failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let (client_id, token, endpoint) = tesapi_lib::mcp::companion::parse_args()?;
    let server =
        tesapi_lib::mcp::companion::CompanionServer::connect(client_id, token, endpoint).await?;
    let service = server
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|error| error.to_string())?;
    service
        .waiting()
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}
