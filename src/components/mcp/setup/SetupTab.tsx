import { useState } from 'react';
import { ExternalLink, Info } from 'lucide-react';
import { generateManualMcpConfig, installMcpConfig, previewMcpConfig, removeMcpConfig } from '../../../lib/mcp/client';
import type { ConfigPreview } from '../../../lib/mcp/types';
import { useMcpStore } from '../../../store/mcpStore';
import type { ToastMessage } from '../../Toast';
import { ClientRow } from './ClientRow';
import { ConfigReviewDialog } from './ConfigReviewDialog';
import '../styles/setup.css';

export function SetupTab({ onToast }: { onToast: (message: ToastMessage) => void }) {
  const overview = useMcpStore((state) => state.overview);
  const loadOverview = useMcpStore((state) => state.loadOverview);
  const [preview, setPreview] = useState<ConfigPreview | null>(null);
  const [manual, setManual] = useState(false);
  const [manualGenerated, setManualGenerated] = useState(false);
  const [busyKind, setBusyKind] = useState<string | null>(null);

  const review = async (kind: string, isManual = false) => {
    try { setManual(isManual); setManualGenerated(false); setPreview(await previewMcpConfig(kind)); }
    catch (error) { onToast({ title: 'Could not prepare client config', detail: String(error), tone: 'error' }); }
  };
  const generateManual = async () => {
    setBusyKind('manual');
    try { setPreview(await generateManualMcpConfig(preview?.kind ?? 'manual')); setManualGenerated(true); await loadOverview(); onToast({ title: 'Manual MCP credential generated', detail: 'Copy it now; TesAPI stores only its hash.' }); }
    catch (error) { onToast({ title: 'Could not generate manual config', detail: String(error), tone: 'error' }); }
    finally { setBusyKind(null); }
  };
  const install = async () => {
    if (!preview) return;
    setBusyKind(preview.kind);
    try { await installMcpConfig(preview.kind); setPreview(null); await loadOverview(); onToast({ title: `${preview.displayName} configured`, detail: 'Restart or reload the client before connecting.' }); }
    catch (error) { onToast({ title: 'Could not install configuration', detail: String(error), tone: 'error' }); }
    finally { setBusyKind(null); }
  };
  const remove = async (kind: string, name: string) => {
    if (!window.confirm(`Remove the TesAPI MCP entry from ${name}? Other client settings are preserved.`)) return;
    setBusyKind(kind);
    try { await removeMcpConfig(kind); await loadOverview(); onToast({ title: `${name} configuration removed` }); }
    catch (error) { onToast({ title: 'Could not remove configuration', detail: String(error), tone: 'error' }); }
    finally { setBusyKind(null); }
  };

  return (
    <div className="mcp-tab-page mcp-setup-page">
      <div className="mcp-section-heading"><div><span className="label-caps">Client connections</span><h2>Choose where TesAPI should appear</h2><p>Installation is reviewed, scoped, and reversible. Existing MCP servers remain untouched.</p></div><a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">About MCP <ExternalLink size={11} /></a></div>
      <div className="mcp-client-list">{overview?.clients.map((client) => <ClientRow key={client.kind} client={client} busy={busyKind === client.kind} onInstall={() => void review(client.kind)} onRemove={() => void remove(client.kind, client.displayName)} onManual={() => void review(client.kind, true)} />)}</div>
      <div className="mcp-setup-footnote"><Info size={13} /><span>TesAPI must be available for tools to run. The companion can launch the app when needed, while all permissions and secrets stay inside TesAPI.</span></div>
      <ConfigReviewDialog preview={preview} busy={!!busyKind} manual={manual} manualGenerated={manualGenerated} onClose={() => setPreview(null)} onConfirm={() => void (manual ? generateManual() : install())} />
    </div>
  );
}
