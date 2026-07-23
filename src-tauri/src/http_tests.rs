use super::{http_active_requests, send_header, single_raw_file, RequestActivity, TesApiRequest};

#[test]
fn tracks_active_requests_until_the_guard_drops() {
    assert_eq!(http_active_requests(), 0);
    let activity = RequestActivity::start();
    assert_eq!(http_active_requests(), 1);
    drop(activity);
    assert_eq!(http_active_requests(), 0);
}

#[test]
fn deserializes_multipart_file() {
    let req: TesApiRequest = serde_json::from_value(serde_json::json!({
        "method": "POST",
        "url": "https://example.com/upload",
        "params": [],
        "headers": [{ "key": "Content-Type", "value": "multipart/form-data; boundary=stale", "enabled": true }],
        "body": {
            "type": "form-data",
            "formData": [{
                "key": "attachment",
                "value": "",
                "enabled": true,
                "valueType": "file",
                "files": [{
                    "name": "receipt.pdf",
                    "mimeType": "application/pdf",
                    "sizeBytes": 3,
                    "data": [1, 2, 3]
                }]
            }]
        },
        "auth": { "type": "none" }
    }))
    .unwrap();

    let form_data = req.body.form_data.as_ref().unwrap();
    let file = &form_data[0].files.as_ref().unwrap()[0];
    assert_eq!(file.name, "receipt.pdf");
    assert_eq!(file.data, [1, 2, 3]);
    assert_eq!(single_raw_file(&req.body).unwrap().name, "receipt.pdf");
    assert!(!send_header(&req.body, &req.headers[0]));
}
