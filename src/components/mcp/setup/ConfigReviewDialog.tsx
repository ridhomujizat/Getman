import { Check, Copy, FileCog, ShieldCheck, X } from 'lucide-react';
import type { ConfigPreview } from '../../../lib/mcp/types';

interface Props {
  preview: ConfigPreview | null;
  busy: boolean;
  manual?: boolean;
  manualGenerated?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfigReviewDialog({ preview, busy, manual = false, manualGenerated = false, onClose, onConfirm }: Props) {
  if (!preview) return null;
  const copy = () => void navigator.clipboard.writeText(preview.snippet);
  return (
    <div className="modal-backdrop mcp-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="mcp-config-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-config-title">
        <header><div className="mcp-dialog-icon"><FileCog size={17} /></div><div><span className="label-caps">Configuration review</span><h2 id="mcp-config-title">{manual ? 'Connect manually' : `${preview.operation === 'create' ? 'Install' : 'Update'} ${preview.displayName}`}</h2></div><button aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button></header>
        <div className="mcp-config-body">
          {!manual ? <div className="mcp-config-safety"><ShieldCheck size={15} /><span>TesAPI changes only the <code>tesapi</code> server entry and preserves all unrelated settings.</span></div> : null}
          <dl><div><dt>Target</dt><dd>{preview.targetPath}</dd></div><div><dt>Command</dt><dd><code>{preview.command}</code></dd></div><div><dt>Backup</dt><dd>{preview.backupRequired ? 'Timestamped backup before writing' : 'Not needed for a new file'}</dd></div></dl>
          <div className="mcp-snippet-heading"><span>Generated configuration</span><button onClick={copy}><Copy size={12} /> Copy</button></div>
          <pre>{preview.snippet}</pre>
          <p className="mcp-config-note">The real per-client token is generated only when you confirm. It is written to the client config and stored in TesAPI as a one-way hash.</p>
        </div>
        <footer><button onClick={onClose} disabled={busy}>Cancel</button>{manual && manualGenerated ? <button className="primary" onClick={copy}><Copy size={13} /> Copy config</button> : <button className="primary" onClick={onConfirm} disabled={busy}>{busy ? <span className="spinner" /> : <Check size={13} />} {manual ? 'Generate secure config' : `Confirm ${preview.operation}`}</button>}</footer>
      </section>
    </div>
  );
}
