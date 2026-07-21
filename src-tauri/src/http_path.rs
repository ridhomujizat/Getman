use std::fmt::Write;

use crate::http::KeyValue;

fn encode_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            write!(encoded, "%{byte:02X}").expect("writing to a String cannot fail");
        }
    }
    encoded
}

pub(crate) fn substitute_path_variables(url: &str, rows: &[KeyValue]) -> String {
    let path_end = url.find(['?', '#']).unwrap_or(url.len());
    let (path, suffix) = url.split_at(path_end);
    let bytes = path.as_bytes();
    let mut output = String::with_capacity(url.len());
    let mut cursor = 0;
    let mut index = 0;
    while index + 2 < bytes.len() {
        if bytes[index] != b'/' || bytes[index + 1] != b':' {
            index += 1;
            continue;
        }
        let start = index + 2;
        let mut end = start;
        while end < bytes.len()
            && (bytes[end].is_ascii_alphanumeric() || matches!(bytes[end], b'_' | b'-'))
        {
            end += 1;
        }
        let valid = end > start
            && (bytes[start].is_ascii_alphabetic() || bytes[start] == b'_')
            && (end == bytes.len() || bytes[end] == b'/');
        let Some(row) = valid
            .then(|| &path[start..end])
            .and_then(|name| rows.iter().find(|row| row.enabled && row.key == name))
        else {
            index += 1;
            continue;
        };
        output.push_str(&path[cursor..index + 1]);
        output.push_str(&encode_segment(&row.value));
        cursor = end;
        index = end;
    }
    output.push_str(&path[cursor..]);
    output.push_str(suffix);
    output
}

#[cfg(test)]
mod tests {
    use super::substitute_path_variables;
    use crate::http::KeyValue;

    #[test]
    fn substitutes_and_encodes_path_variables() {
        let rows = vec![KeyValue {
            key: "id".into(),
            value: "Ada Lovelace/42".into(),
            enabled: true,
            value_type: None,
            files: None,
        }];
        assert_eq!(
            substitute_path_variables("https://example.com/users/:id?next=/:id", &rows),
            "https://example.com/users/Ada%20Lovelace%2F42?next=/:id"
        );
    }
}
