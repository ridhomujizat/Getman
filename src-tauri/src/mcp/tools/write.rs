use tauri::Manager;

use crate::{
    db::WorkspaceRecord, git_commands, git_commit, mcp::policy, workspace_io::WorkspaceQueueState,
};

use super::{with_connection, ToolContext, ToolError};

pub async fn auto_commit(
    context: &ToolContext<'_>,
    workspace: &WorkspaceRecord,
    paths: &[String],
) -> Result<Option<String>, ToolError> {
    let enabled = with_connection(context.app, |connection| {
        policy::setting_bool(
            connection,
            &format!("workspace:{}:autoCommitOnSave", workspace.id),
            false,
        )
    })
    .map_err(internal)?;
    if !enabled || workspace.sync_type != "git" {
        return Ok(None);
    }
    let paths = paths.to_vec();
    Ok(git_commands::queued_git(
        workspace.root_path.clone(),
        context.app.state::<WorkspaceQueueState>(),
        move |root, _cancel| {
            let repo = git2::Repository::open(root).map_err(|error| error.message().to_owned())?;
            git_commit::commit_relative_paths(&repo, &paths)
        },
    )
    .await
    .err())
}

fn internal(error: String) -> ToolError {
    ToolError::new("INTERNAL_ERROR", error)
}
