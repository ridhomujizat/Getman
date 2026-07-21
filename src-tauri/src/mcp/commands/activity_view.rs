use crate::mcp::{
    redaction,
    types::{McpActivity, McpSafetySettings},
};

pub(super) fn redact_activity(
    mut records: Vec<McpActivity>,
    settings: &McpSafetySettings,
) -> Vec<McpActivity> {
    for record in &mut records {
        record.input_summary = redaction::activity_summary(
            &record.input_summary,
            &settings.sensitive_key_patterns,
            settings.store_body_previews,
        );
        record.output_summary = redaction::activity_summary(
            &record.output_summary,
            &settings.sensitive_key_patterns,
            settings.store_body_previews,
        );
        record.error_detail = record
            .error_detail
            .as_deref()
            .map(|detail| redaction::truncate(detail, 8 * 1024).0);
    }
    records
}

pub(super) fn activity_csv(records: &[McpActivity]) -> String {
    let mut lines = vec!["time,client,session,tool,workspace,collection,request,duration_ms,status,approval,error_code,error_detail".into()];
    lines.extend(records.iter().map(|record| {
        [
            record.started_at.to_string(),
            record.client_name.clone(),
            record.session_id.clone(),
            record.tool_name.clone(),
            record.workspace_id.clone().unwrap_or_default(),
            record.collection_id.clone().unwrap_or_default(),
            record.request_id.clone().unwrap_or_default(),
            record
                .duration_ms
                .map(|value| value.to_string())
                .unwrap_or_default(),
            record.status.clone(),
            record.approval_decision.clone().unwrap_or_default(),
            record.error_code.clone().unwrap_or_default(),
            record.error_detail.clone().unwrap_or_default(),
        ]
        .into_iter()
        .map(csv_cell)
        .collect::<Vec<_>>()
        .join(",")
    }));
    lines.join("\n")
}

fn csv_cell(value: String) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
