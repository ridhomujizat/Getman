import { useEffect, useRef, useState } from 'react';
import { FileJson, FileUp, X } from 'lucide-react';

export type ImportSource = 'postman' | 'insomnia' | 'openapi' | 'har';

interface Props {
  open: boolean;
  onCancel: () => void;
  onImport: (file: File, source: ImportSource) => Promise<void>;
}

export function ImportCollectionModal({ open, onCancel, onImport }: Props) {
  const [source, setSource] = useState<ImportSource>('postman');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSource('postman'); setFile(null); setDragging(false); setBusy(false); setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onCancel, open]);

  if (!open) return null;
  const choose = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.json')) { setError('Choose a JSON collection file.'); return; }
    setFile(candidate); setError('');
  };
  const submit = async () => {
    if (!file) { setError('Choose a collection file first.'); return; }
    setBusy(true); setError('');
    try { await onImport(file, source); onCancel(); }
    catch (cause) { setError(String(cause).replace(/^Error:\s*/, '')); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop import-collection-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section className="import-collection-modal" role="dialog" aria-modal="true" aria-labelledby="import-collection-title">
      <header><div><span className="label-caps">COLLECTION IMPORT</span><h2 id="import-collection-title">Bring your API workspace in</h2><p>Choose a source, then drop its export here. It becomes a new collection in this workspace.</p></div><button className="modal-close" aria-label="Close import dialog" disabled={busy} onClick={onCancel}><X size={14} /></button></header>
      <div className="import-collection-body">
        <label className="import-source-select"><span>Import source <small>More connectors can plug into this list later.</small></span><select value={source} disabled={busy} onChange={(event) => { setSource(event.target.value as ImportSource); setError(''); }}><option value="postman">Postman collection · JSON · Ready</option><option value="insomnia" disabled>Insomnia export · JSON · Soon</option><option value="openapi" disabled>OpenAPI / Swagger · YAML or JSON · Soon</option><option value="har" disabled>HAR archive · Browser capture · Soon</option></select></label>
        <div className={`import-drop-zone${dragging ? ' dragging' : ''}${file ? ' has-file' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]); }}>
          {file ? <><span className="import-file-icon"><FileJson size={22} /></span><div><strong>{file.name}</strong><small>{Math.ceil(file.size / 1024)} KB · Ready to import</small></div><button className="import-file-clear" aria-label="Remove selected file" onClick={() => setFile(null)}><X size={13} /></button></> : <><span className="import-upload-icon"><FileUp size={22} /></span><div><strong>Drop a collection export here</strong><small>Postman JSON is ready now. Other formats will be added here.</small></div><button className="import-browse-button" onClick={() => inputRef.current?.click()}>Browse files</button></>}
        </div>
        <input ref={inputRef} className="collection-import-input" type="file" accept=".json,application/json" onChange={(event) => choose(event.target.files?.[0])} />
        {error && <div className="save-modal-error">{error}</div>}
      </div>
      <footer><span><small>Imported data stays in this workspace.</small></span><div><button className="modal-cancel" disabled={busy} onClick={onCancel}>Cancel</button><button className="modal-save" disabled={busy || !file} onClick={() => void submit()}>{busy ? <span className="spinner" /> : <FileUp size={13} />}{busy ? 'Importing…' : 'Import collection'}</button></div></footer>
    </section>
  </div>;
}
