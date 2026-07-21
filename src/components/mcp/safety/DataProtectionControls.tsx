import { useEffect, useState } from 'react';
import { FileLock2 } from 'lucide-react';
import type { McpSafetySettings } from '../../../lib/mcp/types';

interface Props {
  settings: McpSafetySettings;
  onSave: (settings: McpSafetySettings) => Promise<void>;
}

export function DataProtectionControls({ settings, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  const [patterns, setPatterns] = useState(settings.sensitiveKeyPatterns.join(', '));
  const [destinations, setDestinations] = useState(settings.trustedDestinations.join('\n'));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
    setPatterns(settings.sensitiveKeyPatterns.join(', '));
    setDestinations(settings.trustedDestinations.join('\n'));
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        ...draft,
        sensitiveKeyPatterns: splitList(patterns),
        trustedDestinations: splitList(destinations),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mcp-data-protection">
      <div className="mcp-subheading"><FileLock2 size={15} /><div><h3>Protected data & retention</h3><p>Built-in credential rules always apply. These controls can only add protection.</p></div></div>
      <div className="mcp-protection-grid">
        <label className="mcp-protection-toggle"><span><strong>Store body previews</strong><small>Off by default. When enabled, previews remain redacted and size-limited.</small></span><span className="mcp-toggle"><input type="checkbox" checked={draft.storeBodyPreviews} onChange={(event) => setDraft({ ...draft, storeBodyPreviews: event.target.checked })} /><span /></span></label>
        <label><span>Additional protected key patterns</span><textarea value={patterns} placeholder="pin, client_secret, signature" onChange={(event) => setPatterns(event.target.value)} /></label>
        <label><span>Trusted private destinations</span><textarea value={destinations} placeholder={'dev.internal\nhttp://127.0.0.1:3000'} onChange={(event) => setDestinations(event.target.value)} /><small>Exact hostnames only. Plain HTTP and unsafe methods still remain risky.</small></label>
        <div className="mcp-retention-fields"><label><span>Retention days</span><input type="number" min="1" max="365" value={draft.activityRetentionDays} onChange={(event) => setDraft({ ...draft, activityRetentionDays: Number(event.target.value) })} /></label><label><span>Maximum rows</span><input type="number" min="100" max="100000" step="100" value={draft.activityMaxRows} onChange={(event) => setDraft({ ...draft, activityMaxRows: Number(event.target.value) })} /></label></div>
      </div>
      <div className="mcp-protection-actions"><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save protection settings'}</button></div>
    </section>
  );
}

const splitList = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

