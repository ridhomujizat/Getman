import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ActivityTab } from './activity/ActivityTab';
import { SafetyTab } from './safety/SafetyTab';
import { SetupTab } from './setup/SetupTab';
import { McpHeader } from './McpHeader';
import { useMcpStore } from '../../store/mcpStore';
import type { McpWorkspaceProps } from '../../lib/mcp/types';
import './styles/shell.css';

type Tab = 'setup' | 'activity' | 'safety';

export function McpWorkspace({ currentWorkspace, workspaces, onToast, embedded = false }: McpWorkspaceProps) {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('tesapi:mcp-tab') as Tab | null) ?? 'setup');
  const refresh = useMcpStore((state) => state.refresh);
  const overview = useMcpStore((state) => state.overview);
  const loadError = useMcpStore((state) => state.loadError);

  useEffect(() => { void refresh(currentWorkspace.id); }, [currentWorkspace.id, refresh]);
  useEffect(() => {
    const unlisteners = ['mcp-state-changed', 'mcp-activity-changed'].map((event) => listen(event, () => void refresh(currentWorkspace.id)));
    return () => { void Promise.all(unlisteners).then((items) => items.forEach((unlisten) => unlisten())); };
  }, [currentWorkspace.id, refresh]);

  const changeTab = (next: Tab) => { setTab(next); sessionStorage.setItem('tesapi:mcp-tab', next); };

  return (
    <section className={`mcp-workspace${embedded ? ' embedded' : ''}`}>
      <McpHeader overview={overview} onToast={onToast} />
      <nav className="mcp-tabs" aria-label="MCP Server sections">
        {(['setup', 'activity', 'safety'] as const).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => changeTab(item)}>{item}</button>)}
      </nav>
      {loadError ? <div className="mcp-load-error">{loadError}</div> : null}
      <div className="mcp-content">
        {tab === 'setup' ? <SetupTab onToast={onToast} /> : null}
        {tab === 'activity' ? <ActivityTab workspaces={workspaces} onToast={onToast} /> : null}
        {tab === 'safety' ? <SafetyTab currentWorkspace={currentWorkspace} workspaces={workspaces} onToast={onToast} /> : null}
      </div>
    </section>
  );
}
