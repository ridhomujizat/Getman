use rusqlite::Connection;

pub const SCHEMA_VERSION: i64 = 3;

pub fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS mcp_clients (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                display_name TEXT NOT NULL,
                config_path TEXT,
                token_hash TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                capability TEXT NOT NULL DEFAULT 'read',
                config_fingerprint TEXT,
                installed_at INTEGER,
                last_seen_at INTEGER
            );
            CREATE UNIQUE INDEX IF NOT EXISTS mcp_client_kind_path
                ON mcp_clients(kind, COALESCE(config_path,''));
            CREATE TABLE IF NOT EXISTS mcp_policies (
                id TEXT PRIMARY KEY,
                client_id TEXT,
                workspace_id TEXT,
                collection_id TEXT,
                environment_id TEXT,
                capability TEXT NOT NULL,
                environment_class TEXT,
                environment_use INTEGER,
                approval_mode TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS mcp_policy_scope
                ON mcp_policies(COALESCE(client_id,''), COALESCE(workspace_id,''), COALESCE(collection_id,''), COALESCE(environment_id,''));
            CREATE TABLE IF NOT EXISTS mcp_sessions (
                id TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                protocol_version TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                last_seen_at INTEGER NOT NULL,
                end_reason TEXT
            );
            CREATE INDEX IF NOT EXISTS mcp_sessions_client ON mcp_sessions(client_id, started_at DESC);
            CREATE TABLE IF NOT EXISTS mcp_drafts (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                origin_collection_id TEXT,
                origin_request_id TEXT,
                created_by_client_id TEXT NOT NULL,
                created_by_session_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                request_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS mcp_drafts_workspace ON mcp_drafts(workspace_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS mcp_activity (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                workspace_id TEXT,
                collection_id TEXT,
                request_id TEXT,
                draft_id TEXT,
                status TEXT NOT NULL,
                policy_reasons_json TEXT NOT NULL DEFAULT '[]',
                input_summary_json TEXT NOT NULL DEFAULT '{}',
                output_summary_json TEXT NOT NULL DEFAULT '{}',
                error_code TEXT,
                error_detail TEXT,
                started_at INTEGER NOT NULL,
                completed_at INTEGER,
                duration_ms INTEGER
            );
            CREATE INDEX IF NOT EXISTS mcp_activity_started ON mcp_activity(started_at DESC);
            CREATE INDEX IF NOT EXISTS mcp_activity_client ON mcp_activity(client_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS mcp_activity_status ON mcp_activity(status, started_at DESC);
            CREATE INDEX IF NOT EXISTS mcp_activity_tool ON mcp_activity(tool_name, started_at DESC);
            CREATE INDEX IF NOT EXISTS mcp_activity_workspace ON mcp_activity(workspace_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS mcp_activity_session ON mcp_activity(session_id, started_at DESC);
            CREATE TABLE IF NOT EXISTS mcp_approvals (
                id TEXT PRIMARY KEY,
                activity_id TEXT NOT NULL,
                workspace_id TEXT,
                request_fingerprint TEXT NOT NULL,
                risk_reasons_json TEXT NOT NULL,
                summary_json TEXT NOT NULL,
                decision TEXT NOT NULL DEFAULT 'pending',
                scope_json TEXT,
                requested_at INTEGER NOT NULL,
                decided_at INTEGER,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS mcp_approvals_pending ON mcp_approvals(decision, requested_at DESC);",
        )
        .map_err(|error| error.to_string())?;
    ensure_approval_workspace_column(connection)?;
    connection
        .pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|error| error.to_string())
}

fn ensure_approval_workspace_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(mcp_approvals)")
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if !columns.iter().any(|column| column == "workspace_id") {
        connection
            .execute("ALTER TABLE mcp_approvals ADD COLUMN workspace_id TEXT", [])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn recover(connection: &Connection, now: i64) -> Result<(), String> {
    connection
        .execute(
            "UPDATE mcp_sessions SET ended_at=?1,end_reason='app_restart' WHERE ended_at IS NULL",
            [now],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE mcp_approvals SET decision='cancelled',decided_at=?1 WHERE decision='pending'",
            [now],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE mcp_activity SET status='cancelled',completed_at=?1,duration_ms=?1-started_at,error_code='APP_RESTARTED',error_detail='TesAPI restarted before the call completed.' WHERE status IN ('pending','awaiting_approval')",
            [now],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM mcp_drafts WHERE expires_at < ?1", [now])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{migrate, recover};
    use rusqlite::Connection;

    #[test]
    fn recover_should_cancel_pending_approval_and_activity() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        connection.execute_batch("INSERT INTO mcp_clients(id,kind,display_name,token_hash) VALUES('c','manual','Client','hash'); INSERT INTO mcp_sessions(id,client_id,protocol_version,started_at,last_seen_at) VALUES('s','c','v',1,1); INSERT INTO mcp_activity(id,session_id,client_id,tool_name,status,started_at) VALUES('a','s','c','tool','awaiting_approval',1); INSERT INTO mcp_approvals(id,activity_id,request_fingerprint,risk_reasons_json,summary_json,requested_at,expires_at) VALUES('p','a','f','[]','{}',1,100);").unwrap();
        recover(&connection, 10).unwrap();
        let state = connection.query_row("SELECT a.status,p.decision FROM mcp_activity a JOIN mcp_approvals p ON p.activity_id=a.id", [], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).unwrap();
        assert_eq!(state, ("cancelled".into(), "cancelled".into()));
    }

    #[test]
    fn migrate_should_add_workspace_id_to_existing_approvals_table() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE mcp_approvals (id TEXT PRIMARY KEY,activity_id TEXT NOT NULL,request_fingerprint TEXT NOT NULL,risk_reasons_json TEXT NOT NULL,summary_json TEXT NOT NULL,decision TEXT NOT NULL DEFAULT 'pending',scope_json TEXT,requested_at INTEGER NOT NULL,decided_at INTEGER,expires_at INTEGER NOT NULL); INSERT INTO mcp_approvals (id,activity_id,request_fingerprint,risk_reasons_json,summary_json,requested_at,expires_at) VALUES ('approval','activity','fingerprint','[]','{}',1,2);").unwrap();

        migrate(&connection).unwrap();

        let record = connection
            .query_row(
                "SELECT id,workspace_id FROM mcp_approvals WHERE id='approval'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .unwrap();
        assert_eq!(record, ("approval".into(), None));
    }
}
