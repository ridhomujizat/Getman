import { useState } from 'react';
import { CheckCircle2, Download, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useUpdateStore } from '../../lib/updates/store';
import type { ToastMessage } from '../Toast';

interface Props {
  onInstall: () => Promise<void>;
  onToast: (message: ToastMessage) => void;
}

const RELEASES_URL = 'https://github.com/ridhomujizat/TesAPI/releases';

export function UpdateSettings({ onInstall, onToast }: Props) {
  const state = useUpdateStore();
  const [installError, setInstallError] = useState('');
  const progress = state.contentLength ? Math.min(100, Math.round(state.downloadedBytes / state.contentLength * 100)) : null;
  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';

  const install = async () => {
    setInstallError('');
    try { await onInstall(); }
    catch (error) {
      const detail = String(error).replace(/^Error:\s*/, '');
      setInstallError(detail);
      onToast({ title: 'Update is waiting', detail, tone: 'error' });
    }
  };

  return (
    <section className="update-settings" aria-labelledby="update-settings-title">
      <div className="update-settings-heading"><div><span className="label-caps">Updates</span><h2 id="update-settings-title">TesAPI {state.installedVersion || '...'}</h2><p>Signed stable releases from GitHub.</p></div>{state.status === 'idle' && state.lastCheckedAt ? <CheckCircle2 size={18} /> : <RefreshCw size={18} className={state.status === 'checking' ? 'spin' : ''} />}</div>
      <label className="update-toggle"><span><strong>Check automatically</strong><small>Check once per day after your workspace opens.</small></span><input type="checkbox" checked={state.autoCheck} onChange={(event) => void state.setAutoCheck(event.target.checked)} /><i><em /></i></label>
      <div className="update-status-card">
        <div className="update-status-copy">
          <strong>{state.release ? `Version ${state.release.version} is available` : state.status === 'checking' ? 'Checking for updates...' : 'You are up to date'}</strong>
          <span>{state.lastCheckedAt ? `Last checked ${new Date(state.lastCheckedAt).toLocaleString()}` : 'Not checked yet'}</span>
        </div>
        {state.release?.notes ? <p className="update-notes">{state.release.notes}</p> : null}
        {state.status === 'downloading' ? <div className="update-progress"><i style={{ width: `${progress ?? 35}%` }} /><span>{progress == null ? 'Downloading...' : `${progress}%`}</span></div> : null}
        {state.error || installError ? <p className="update-error">{installError || state.error}</p> : null}
        <div className="update-actions">
          <button disabled={busy} onClick={() => void state.checkForUpdates(true)}><RefreshCw size={13} /> Check for updates</button>
          {state.status === 'available' ? <button className="primary" onClick={() => void state.download()}><Download size={13} /> Download update</button> : null}
          {state.status === 'ready' ? <button className="primary" onClick={() => void install()}><RotateCcw size={13} /> Restart and update</button> : null}
          <button onClick={() => void openUrl(RELEASES_URL)}><ExternalLink size={13} /> Releases</button>
        </div>
      </div>
    </section>
  );
}
