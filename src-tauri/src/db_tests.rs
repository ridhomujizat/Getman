use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;

use crate::{
    db::{configure, delete_workspace, migrate_json},
    mcp::schema::SCHEMA_VERSION,
};

fn temp(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "tesapi-phase5-{name}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn migrates_legacy_registry_once_and_sets_version() {
    let root = temp("migration");
    fs::create_dir_all(root.join("workspaces/one")).unwrap();
    fs::write(root.join("workspaces.json"), r#"{"activeWorkspaceId":"one","workspaces":[{"id":"one","name":"Legacy","storage":{"type":"local"}}]}"#).unwrap();
    let connection = Connection::open(root.join("app.db")).unwrap();
    configure(&connection).unwrap();
    migrate_json(&connection, &root).unwrap();
    migrate_json(&connection, &root).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM workspaces", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(root.join("workspaces.json.migrated").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn two_connections_write_with_wal() {
    let root = temp("wal");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("app.db");
    let one = Connection::open(&path).unwrap();
    let two = Connection::open(&path).unwrap();
    configure(&one).unwrap();
    configure(&two).unwrap();
    one.execute("INSERT INTO settings VALUES ('one','1')", [])
        .unwrap();
    two.execute("INSERT INTO settings VALUES ('two','2')", [])
        .unwrap();
    assert_eq!(
        one.query_row("SELECT COUNT(*) FROM settings", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn deleting_workspace_only_removes_registry_data() {
    let root = temp("delete-workspace");
    let kept_path = root.join("kept");
    let removed_path = root.join("removed");
    fs::create_dir_all(&kept_path).unwrap();
    fs::create_dir_all(&removed_path).unwrap();
    fs::write(removed_path.join("request.json"), "{}").unwrap();
    let mut connection = Connection::open_in_memory().unwrap();
    configure(&connection).unwrap();
    for (id, path) in [("kept", &kept_path), ("removed", &removed_path)] {
        connection.execute("INSERT INTO workspaces (id,name,sync_type,root_path,created_at) VALUES (?1,?1,'local',?2,1)", (id, path.to_string_lossy())).unwrap();
    }
    connection
        .execute(
            "INSERT INTO settings VALUES ('workspace:removed:autoCommitOnSave','true')",
            [],
        )
        .unwrap();
    connection
        .execute("INSERT INTO settings VALUES ('unrelated','true')", [])
        .unwrap();

    delete_workspace(&mut connection, "removed").unwrap();

    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM workspaces WHERE id='removed'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key LIKE 'workspace:removed:%'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key='unrelated'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert!(removed_path.join("request.json").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn deleting_the_only_workspace_is_rejected() {
    let mut connection = Connection::open_in_memory().unwrap();
    configure(&connection).unwrap();
    connection.execute("INSERT INTO workspaces (id,name,sync_type,root_path,created_at) VALUES ('only','Only','local','/tmp/only',1)", []).unwrap();

    assert_eq!(
        delete_workspace(&mut connection, "only").unwrap_err(),
        "TesAPI needs at least one workspace."
    );
}
