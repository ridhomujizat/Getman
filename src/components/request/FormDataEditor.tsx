import { File, Trash2, X } from 'lucide-react';
import { uid } from '../../lib/id';
import type { KeyValue, UploadFile } from '../../types';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
}

export function FormDataEditor({ rows, onChange }: Props) {
  const update = (id: string, patch: Partial<KeyValue>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const remove = (id: string) => {
    const next = rows.filter((row) => row.id !== id);
    onChange(next.length ? next : [{ id: uid(), key: '', value: '', enabled: true }]);
  };

  const selectFiles = async (row: KeyValue, list: FileList | null) => {
    if (!list?.length) return;
    // ponytail: in-memory IPC is simplest for personal uploads; stream file paths if huge files matter.
    const files: UploadFile[] = await Promise.all(Array.from(list).map(async (file) => ({
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      data: Array.from(new Uint8Array(await file.arrayBuffer())),
    })));
    update(row.id, { files: [...(row.files ?? []), ...files] });
  };

  return (
    <div className="form-data-editor">
      <div className="form-data-header">
        <span /><span>KEY</span><span>TYPE</span><span>VALUE</span><span>DESCRIPTION</span><span />
      </div>
      {rows.map((row) => {
        const isFile = row.valueType === 'file';
        const files = row.files ?? [];
        return (
          <div key={row.id} className={`form-data-row${row.enabled ? '' : ' disabled'}`}>
            <input type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, { enabled: event.target.checked })} />
            <input className="form-cell mono" placeholder="Key" value={row.key} onChange={(event) => update(row.id, { key: event.target.value })} />
            <select
              className="form-type"
              aria-label={`Type for ${row.key || 'new field'}`}
              value={row.valueType ?? 'text'}
              onChange={(event) => update(row.id, {
                valueType: event.target.value as KeyValue['valueType'],
                value: '',
                files: [],
              })}
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>
            {isFile ? (
              <div className="file-value">
                {files.map((file, index) => (
                  <span className="file-chip" key={`${file.name}-${index}`}>
                    <File size={12} /><span>{file.name}</span>
                    <button title={`Remove ${file.name}`} onClick={() => update(row.id, { files: files.filter((_, i) => i !== index) })}><X size={11} /></button>
                  </span>
                ))}
                <label className="choose-file">
                  {files.length ? 'Add' : 'Choose file'}
                  <input
                    className="file-input"
                    type="file"
                    multiple
                    onChange={(event) => {
                      void selectFiles(row, event.target.files);
                      event.target.value = '';
                    }}
                  />
                </label>
                {!files.length && <span className="no-file mono">No file selected</span>}
              </div>
            ) : (
              <input className="form-cell mono" placeholder="Value" value={row.value} onChange={(event) => update(row.id, { value: event.target.value })} />
            )}
            <input className="form-cell description" placeholder="Description" value={row.description ?? ''} onChange={(event) => update(row.id, { description: event.target.value })} />
            <button className="form-delete" title="Remove field" onClick={() => remove(row.id)}><Trash2 size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
