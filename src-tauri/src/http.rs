use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub form_data: Option<Vec<KeyValue>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Auth {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub add_to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetmanRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub params: Vec<KeyValue>,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    pub body: Body,
    pub auth: Auth,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetmanResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
    pub time_ms: u128,
    pub size_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum HttpError {
    Timeout(String),
    DnsFailure(String),
    ConnectionRefused(String),
    InvalidUrl(String),
    TlsError(String),
    Unknown(String),
}

fn classify(err: &reqwest::Error) -> HttpError {
    if err.is_timeout() {
        return HttpError::Timeout("Request timed out".into());
    }
    if err.is_builder() || err.is_request() && err.url().is_none() {
        return HttpError::InvalidUrl(format!("Invalid URL: {err}"));
    }
    let s = err.to_string().to_lowercase();
    if s.contains("dns") || s.contains("resolve") || s.contains("name or service") {
        HttpError::DnsFailure("Could not resolve host".into())
    } else if s.contains("refused") {
        HttpError::ConnectionRefused("Connection refused".into())
    } else if s.contains("tls") || s.contains("certificate") || s.contains("ssl") {
        HttpError::TlsError(format!("TLS error: {err}"))
    } else {
        HttpError::Unknown(err.to_string())
    }
}

#[tauri::command]
pub async fn send_request(req: GetmanRequest) -> Result<GetmanResponse, HttpError> {
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|_| HttpError::InvalidUrl(format!("Bad method: {}", req.method)))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| classify(&e))?;

    // Query params (enabled only) + api-key-in-query auth.
    let mut query: Vec<(String, String)> = req
        .params
        .iter()
        .filter(|p| p.enabled && !p.key.is_empty())
        .map(|p| (p.key.clone(), p.value.clone()))
        .collect();
    if req.auth.kind == "api-key" && req.auth.add_to.as_deref() == Some("query") {
        if let (Some(k), Some(v)) = (&req.auth.key, &req.auth.value) {
            query.push((k.clone(), v.clone()));
        }
    }

    let mut url = reqwest::Url::parse(&req.url)
        .map_err(|e| HttpError::InvalidUrl(format!("Invalid URL: {e}")))?;
    url.query_pairs_mut().clear().extend_pairs(&query);
    let mut builder = client.request(method, url);

    for h in req.headers.iter().filter(|h| h.enabled && !h.key.is_empty()) {
        builder = builder.header(&h.key, &h.value);
    }

    // Auth.
    builder = match req.auth.kind.as_str() {
        "bearer" => builder.bearer_auth(req.auth.token.clone().unwrap_or_default()),
        "basic" => builder.basic_auth(
            req.auth.username.clone().unwrap_or_default(),
            req.auth.password.clone(),
        ),
        "api-key" if req.auth.add_to.as_deref() != Some("query") => builder.header(
            req.auth.key.clone().unwrap_or_default(),
            req.auth.value.clone().unwrap_or_default(),
        ),
        _ => builder,
    };

    // Body.
    builder = match req.body.kind.as_str() {
        "json" => builder
            .header("Content-Type", "application/json")
            .body(req.body.raw.clone().unwrap_or_default()),
        "text" => builder
            .header("Content-Type", "text/plain")
            .body(req.body.raw.clone().unwrap_or_default()),
        "x-www-form-urlencoded" => {
            let pairs: Vec<(String, String)> = req
                .body
                .form_data
                .as_ref()
                .map(|d| {
                    d.iter()
                        .filter(|p| p.enabled)
                        .map(|p| (p.key.clone(), p.value.clone()))
                        .collect()
                })
                .unwrap_or_default();
            builder.form(&pairs)
        }
        "form-data" => {
            let mut form = reqwest::multipart::Form::new();
            if let Some(d) = &req.body.form_data {
                for p in d.iter().filter(|p| p.enabled) {
                    form = form.text(p.key.clone(), p.value.clone());
                }
            }
            builder.multipart(form)
        }
        _ => builder,
    };

    let start = Instant::now();
    let resp = builder.send().await.map_err(|e| classify(&e))?;
    let status = resp.status();

    let mut headers = std::collections::HashMap::new();
    for (k, v) in resp.headers().iter() {
        headers.insert(k.to_string(), v.to_str().unwrap_or("").to_string());
    }

    let body = resp.text().await.map_err(|e| classify(&e))?;
    let time_ms = start.elapsed().as_millis();
    let size_bytes = body.len();

    Ok(GetmanResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
        time_ms,
        size_bytes,
    })
}
