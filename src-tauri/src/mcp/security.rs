use std::net::IpAddr;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(hex(&bytes))
}

pub fn new_id(prefix: &str) -> Result<String, String> {
    let mut bytes = [0_u8; 12];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(format!("{prefix}-{}", hex(&bytes)))
}

pub fn hash(value: &str) -> String {
    hex(&Sha256::digest(value.as_bytes()))
}

pub fn token_matches(expected_hash: &str, token: &str) -> bool {
    let actual = hash(token);
    if expected_hash.len() != actual.len() {
        return false;
    }
    expected_hash
        .bytes()
        .zip(actual.bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

pub fn fingerprint(value: &Value) -> String {
    hash(&canonical(value).to_string())
}

pub fn canonical(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        Value::Object(object) => {
            let mut entries = object.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key.clone(), canonical(value)))
                    .collect::<Map<_, _>>(),
            )
        }
        _ => value.clone(),
    }
}

pub fn is_sensitive_name(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase().replace('-', "_");
    [
        "authorization",
        "proxy_authorization",
        "cookie",
        "set_cookie",
        "token",
        "secret",
        "password",
        "passwd",
        "api_key",
        "apikey",
        "session",
    ]
    .iter()
    .any(|pattern| normalized == *pattern || normalized.ends_with(&format!("_{pattern}")))
}

pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.octets() == [169, 254, 169, 254]
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
        }
    }
}

pub async fn destination_is_private(url: &reqwest::Url) -> Result<bool, String> {
    let host = url.host_str().ok_or("URL host is required")?;
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(is_private_ip(ip));
    }
    let port = url.port_or_known_default().ok_or("URL port is required")?;
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| error.to_string())?;
    Ok(addresses
        .into_iter()
        .any(|address| is_private_ip(address.ip())))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{canonical, is_private_ip, token_matches};
    use serde_json::json;

    #[test]
    fn canonical_should_sort_object_keys_recursively() {
        assert_eq!(
            canonical(&json!({"z": {"b": 2, "a": 1}, "a": 0})).to_string(),
            r#"{"a":0,"z":{"a":1,"b":2}}"#
        );
    }

    #[test]
    fn token_matches_should_reject_different_token() {
        assert!(!token_matches(&super::hash("expected"), "different"));
    }

    #[test]
    fn is_private_ip_should_block_metadata_service() {
        assert!(is_private_ip("169.254.169.254".parse().unwrap()));
    }
}
