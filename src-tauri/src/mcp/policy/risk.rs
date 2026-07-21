use serde_json::Value;

pub fn execution_risks(
    method: &str,
    url: &reqwest::Url,
    environment_class: Option<&str>,
    request: &Value,
    private_destination: bool,
    trusted_destination: bool,
) -> Vec<String> {
    let mut risks = Vec::new();
    if environment_class.is_some_and(|class| class.eq_ignore_ascii_case("production")) {
        risks.push("PRODUCTION_ENVIRONMENT".into());
    }
    if !matches!(
        method.to_ascii_uppercase().as_str(),
        "GET" | "HEAD" | "OPTIONS"
    ) {
        risks.push("UNSAFE_METHOD".into());
    }
    if url.scheme() == "http" {
        risks.push("PLAIN_HTTP".into());
    }
    if private_destination && !trusted_destination {
        risks.push("PRIVATE_DESTINATION".into());
    }
    let has_upload = request
        .pointer("/body/formData")
        .and_then(Value::as_array)
        .is_some_and(|rows| {
            rows.iter()
                .any(|row| row.get("valueType").and_then(Value::as_str) == Some("file"))
        });
    if has_upload {
        risks.push("FILE_UPLOAD".into());
    }
    risks
}

pub fn destination_is_trusted(url: &reqwest::Url, trusted_destinations: &[String]) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    trusted_destinations.iter().any(|destination| {
        let destination = destination.trim().to_ascii_lowercase();
        destination == host
            || reqwest::Url::parse(&destination)
                .ok()
                .and_then(|value| value.host_str().map(str::to_owned))
                .as_deref()
                == Some(host)
    })
}

pub fn requires_approval(tool_name: &str, approval_mode: &str, risks: &[String]) -> bool {
    if tool_name == "tesapi_save_request_draft" {
        return true;
    }
    match approval_mode {
        "always" => true,
        "policy" => !risks.is_empty(),
        _ => !risks.is_empty(),
    }
}
