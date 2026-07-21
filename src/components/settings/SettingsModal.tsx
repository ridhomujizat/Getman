import { useEffect } from 'react';
import { AppWindow, Info, RadioTower, Settings2, X } from 'lucide-react';
import type { WorkspaceRecord } from '../../types';
import type { ToastMessage } from '../Toast';
import { McpWorkspace } from '../mcp/McpWorkspace';
import { UpdateSettings } from './UpdateSettings';
import { useUpdateStore } from '../../lib/updates/store';
import './settings.css';
import './update.css';

export type SettingsSection = 'general' | 'mcp' | 'about';

interface Props {
  open: boolean;
  section: SettingsSection;
  currentWorkspace: WorkspaceRecord;
  workspaces: WorkspaceRecord[];
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onToast: (message: ToastMessage) => void;
  onInstallUpdate: () => Promise<void>;
}

const sections = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'mcp', label: 'MCP Server', icon: RadioTower },
  { id: 'about', label: 'About TesAPI', icon: Info },
] as const;

export function SettingsModal({ open, section, currentWorkspace, workspaces, onSectionChange, onClose, onToast, onInstallUpdate }: Props) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="TesAPI settings">
        <aside className="settings-sidebar">
          <nav>{sections.map((item) => { const Icon = item.icon; return <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => onSectionChange(item.id)}><Icon size={14} /><span>{item.label}</span></button>; })}</nav>
        </aside>
        <div className="settings-body">
          <button className="settings-close" aria-label="Close settings" onClick={onClose}><X size={16} /></button>
          {section === 'mcp' ? <McpWorkspace embedded currentWorkspace={currentWorkspace} workspaces={workspaces} onToast={onToast} /> : null}
          {section === 'general' ? <GeneralSettings onOpen={onSectionChange} onInstallUpdate={onInstallUpdate} onToast={onToast} /> : null}
          {section === 'about' ? <AboutSettings /> : null}
        </div>
      </section>
    </div>
  );
}

function GeneralSettings({ onOpen, onInstallUpdate, onToast }: { onOpen: (section: SettingsSection) => void; onInstallUpdate: () => Promise<void>; onToast: (message: ToastMessage) => void }) {
  return <div className="settings-section"><header><span className="label-caps">Application</span><h1>General</h1><p>Configure TesAPI and its integrations.</p></header><div className="settings-card-grid"><button onClick={() => onOpen('mcp')}><RadioTower size={18} /><span><strong>MCP Server</strong><small>Connect Claude, Codex, Cursor, and other AI clients</small></span></button></div><UpdateSettings onInstall={onInstallUpdate} onToast={onToast} /></div>;
}

function AboutSettings() {
  const version = useUpdateStore((state) => state.installedVersion);
  return <div className="settings-section settings-about"><div className="settings-about-mark"><AppWindow size={28} /></div><span className="label-caps">TesAPI {version || '...'}</span><h1>Your local API workbench</h1><p>Requests, environments, Git collaboration, and AI integrations stay under your control.</p></div>;
}
