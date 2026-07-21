import { Bot, CheckCircle2, CircleAlert, Code2, MonitorCog, MoreHorizontal, TerminalSquare } from 'lucide-react';
import type { ClientOverview } from '../../../lib/mcp/types';

const icons = { claude_desktop: MonitorCog, claude_code: TerminalSquare, codex: Code2, cursor: Bot, manual: MoreHorizontal };

interface Props {
  client: ClientOverview;
  busy: boolean;
  onInstall: () => void;
  onRemove: () => void;
  onManual: () => void;
}

export function ClientRow({ client, busy, onInstall, onRemove, onManual }: Props) {
  const Icon = icons[client.kind as keyof typeof icons] ?? Bot;
  const configured = client.configurationStatus === 'configured';
  const managed = configured || client.configurationStatus === 'outdated';
  const invalid = client.configurationStatus === 'invalid';
  return (
    <article className="mcp-client-row">
      <div className="mcp-client-icon"><Icon size={17} /></div>
      <div className="mcp-client-copy">
        <strong>{client.displayName}</strong>
        <span>{client.configPath ?? 'Copy a stdio configuration into any compatible MCP client.'}</span>
      </div>
      <div className="mcp-client-state">
        <span className={client.detected ? 'detected' : 'muted'}>{client.detected ? <CheckCircle2 size={12} /> : <CircleAlert size={12} />}{client.installationStatus.replace('_', ' ')}</span>
        <span className={invalid ? 'invalid' : configured ? 'configured' : 'muted'}>{client.configurationStatus.replace(/_/g, ' ')}</span>
      </div>
      <div className="mcp-client-actions">
        {client.kind === 'manual' ? <button onClick={onManual}>Show config</button> : invalid ? <button onClick={onManual}>Manual config</button> : managed ? <><button onClick={onInstall} disabled={busy}>Update Config</button><button className="danger-text" onClick={onRemove} disabled={busy}>Remove</button></> : <button className="primary" onClick={onInstall} disabled={busy}>Install Config</button>}
      </div>
    </article>
  );
}
