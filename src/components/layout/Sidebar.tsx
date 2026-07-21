import { CollectionsSidebar } from './sidebar/CollectionsSidebar';
import { EnvironmentSidebar } from './sidebar/EnvironmentSidebar';
import { HistorySidebar } from './sidebar/HistorySidebar';
import type { ToastMessage } from '../Toast';
import type { SidebarView, WorkspaceView } from './sidebar/types';
import type { WorkspaceRecord } from '../../types';
import { WorkspaceSwitcher } from '../workspace/WorkspaceSwitcher';
import { GitMenu } from '../git/components/GitMenu';
import { useGitStore } from '../../store/gitStore';
import { useCallback, useState } from 'react';
import { McpSidebar } from './sidebar/McpSidebar';

export type { WorkspaceView } from './sidebar/types';

interface Props {
  currentWorkspace: WorkspaceRecord;
  workspaces: WorkspaceRecord[];
  onToast: (message: ToastMessage) => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
  onCreateWorkspace: () => void;
  onOpenWorkspace: (workspace: WorkspaceRecord) => void;
  onOpenWorkspaceWindow: (workspace: WorkspaceRecord) => void;
  onRenameWorkspace: (id: string, name: string) => Promise<void>;
  onManageWorkspaces: (workspace?: WorkspaceRecord) => void;
}

export function Sidebar({ currentWorkspace, workspaces, onToast, onWorkspaceChange, onCreateWorkspace, onOpenWorkspace, onOpenWorkspaceWindow, onRenameWorkspace, onManageWorkspaces }: Props) {
  const [view, setView] = useState<SidebarView>('collections');
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const git = useGitStore();
  const toggleGitMenu = useCallback(() => setGitMenuOpen((value) => !value), []);
  const closeGitMenu = useCallback(() => setGitMenuOpen(false), []);

  const changeView = (next: SidebarView) => {
    setView(next);
    onWorkspaceChange(next === 'environments' ? 'environment' : next === 'mcp' ? 'mcp' : 'api');
  };

  return <aside className="sidebar" onContextMenu={(event) => event.preventDefault()}>
    <WorkspaceSwitcher current={currentWorkspace} workspaces={workspaces} onCreate={onCreateWorkspace} onOpenHere={onOpenWorkspace} onOpenWindow={onOpenWorkspaceWindow} onRename={onRenameWorkspace} onManage={onManageWorkspaces} onGitMenu={toggleGitMenu} gitDirtyCount={git.entities.length} gitBusy={!!git.inFlight} gitBranch={git.status?.branch} />
    {currentWorkspace.syncType === 'git' && <GitMenu open={gitMenuOpen} onClose={closeGitMenu} workspace={currentWorkspace} onToast={onToast} />}
    {view === 'collections' && <CollectionsSidebar onToast={onToast} onViewChange={changeView} onWorkspaceChange={onWorkspaceChange} />}
    {view === 'history' && <HistorySidebar onToast={onToast} onViewChange={changeView} />}
    {view === 'environments' && <EnvironmentSidebar onToast={onToast} onViewChange={changeView} onWorkspaceChange={onWorkspaceChange} />}
    {view === 'mcp' && <McpSidebar onViewChange={changeView} />}
  </aside>;
}
