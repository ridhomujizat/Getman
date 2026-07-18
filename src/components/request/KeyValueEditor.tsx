import { Trash2 } from 'lucide-react';
import type { KeyValue } from '../../types';
import { uid } from '../../lib/id';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  showDescription?: boolean;
}

export function KeyValueEditor({ rows, onChange, showDescription = true }: Props) {
  const update = (id: string, patch: Partial<KeyValue>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    onChange(next.length ? next : [{ id: uid(), key: '', value: '', enabled: true }]);
  };

  return (
    <div className="kv-editor">
      <div className="kv-header">
        <span />
        <span>KEY</span>
        <span>VALUE</span>
        {showDescription && <span>DESCRIPTION</span>}
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className={`kv-row${row.enabled ? '' : ' disabled'}`}>
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => update(row.id, { enabled: e.target.checked })}
          />
          <input
            className="cell"
            placeholder="Key"
            value={row.key}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <input
            className="cell"
            placeholder="Value"
            value={row.value}
            onChange={(e) => update(row.id, { value: e.target.value })}
          />
          {showDescription && (
            <input
              className="cell desc"
              placeholder="Description"
              value={row.description ?? ''}
              onChange={(e) => update(row.id, { description: e.target.value })}
            />
          )}
          <button className="kv-delete" title="Remove" onClick={() => remove(row.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
