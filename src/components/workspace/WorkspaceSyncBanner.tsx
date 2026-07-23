import { RefreshCw, TriangleAlert } from 'lucide-react';

interface Props { paused: boolean; busy: boolean; mode: 'local' | 'git' | 'cloud'; onRetry: () => void }

export function WorkspaceSyncBanner({ paused, busy, mode, onRetry }: Props) {
  if (!paused) return null;
  const cloud = mode === 'cloud';
  return <aside className="workspace-sync-banner" role="status">
    <TriangleAlert size={15} />
    <div><strong>{cloud ? 'Cloud sync paused' : 'Git sync paused'}</strong><span>{cloud ? 'TesAPI could not reach or apply the cloud workspace. Your local work is safe.' : 'The remote changed repeatedly. Your local work is safe.'}</span></div>
    <button disabled={busy} onClick={onRetry}><RefreshCw size={12} /> {busy ? 'Retrying…' : 'Retry sync'}</button>
  </aside>;
}
