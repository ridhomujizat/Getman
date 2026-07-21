import { ArrowUpCircle, Download, RotateCcw, X } from 'lucide-react';
import { useUpdateStore } from '../../lib/updates/store';
import type { ToastMessage } from '../Toast';

interface Props {
  onInstall: () => Promise<void>;
  onOpenSettings: () => void;
  onToast: (message: ToastMessage) => void;
}

export function UpdatePrompt({ onInstall, onOpenSettings, onToast }: Props) {
  const state = useUpdateStore();
  if (!state.promptVisible || !state.release) return null;
  const install = async () => {
    try { await onInstall(); }
    catch (error) { onToast({ title: 'Update is waiting', detail: String(error).replace(/^Error:\s*/, ''), tone: 'error' }); }
  };
  return (
    <aside className="update-prompt" role="status" aria-label="TesAPI update available">
      <button className="update-prompt-close" aria-label="Remind me later" onClick={state.dismissPrompt}><X size={13} /></button>
      <ArrowUpCircle size={20} />
      <div><strong>TesAPI {state.release.version} is available</strong><span>{state.status === 'ready' ? 'Downloaded and ready to install.' : state.status === 'downloading' ? 'Downloading signed update...' : 'A signed stable update is ready to download.'}</span></div>
      <div className="update-prompt-actions"><button onClick={onOpenSettings}>View details</button>{state.status === 'available' ? <button className="primary" onClick={() => void state.download()}><Download size={12} /> Download</button> : null}{state.status === 'ready' ? <button className="primary" onClick={() => void install()}><RotateCcw size={12} /> Restart</button> : null}</div>
    </aside>
  );
}
