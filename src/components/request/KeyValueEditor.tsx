import { Lock, Trash2, Unlock } from 'lucide-react';
import type { KeyValue } from '../../types';
import { uid } from '../../lib/id';
import { applyRowEdit } from '../../lib/params';
import { VariableInput } from '../VariableInput';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  showDescription?: boolean;
  showSecret?: boolean;
  readOnlyKeys?: boolean;
  allowDelete?: boolean;
}

export function KeyValueEditor({ rows, onChange, showDescription = true, showSecret = false, readOnlyKeys = false, allowDelete = true }: Props) {
  const update = (id: string, patch: Partial<KeyValue>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const edit = (row: KeyValue, patch: Partial<KeyValue>) =>
    onChange(rows.map((item) => (item.id === row.id ? applyRowEdit(item, showSecret && item.secret == null ? { secret: true, ...patch } : patch) : item)));

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    onChange(next.length ? next : [{ id: uid(), key: '', value: '', enabled: false, ...(showSecret ? { secret: true } : {}) }]);
  };

  return (
    <div className={`kv-editor${showSecret ? ' with-secret' : ''}`}>
      <div className="kv-header">
        <span />
        <span>KEY</span>
        <span>VALUE</span>
        {showSecret && <span>VISIBILITY</span>}
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
          <VariableInput
            className="cell"
            placeholder="Key"
            readOnly={readOnlyKeys}
            value={row.key}
            onChange={(e) => edit(row, { key: e.target.value })}
          />
          <VariableInput
            className="cell"
            placeholder="Value"
            value={row.value}
            onChange={(e) => edit(row, { value: e.target.value })}
          />
          {showSecret && <button
            className={`kv-secret${row.secret === false ? ' shared' : ''}`}
            title={row.secret === false ? 'Shared in Git' : 'Stored on this device only'}
            aria-label={row.secret === false ? 'Make variable secret' : 'Share variable value'}
            onClick={() => update(row.id, { secret: row.secret === false })}
          >{row.secret === false ? <Unlock size={12} /> : <Lock size={12} />}{row.secret === false ? 'Shared' : 'Secret'}</button>}
          {showDescription && (
            <input
              className="cell desc"
              placeholder="Description"
              value={row.description ?? ''}
              onChange={(e) => edit(row, { description: e.target.value })}
            />
          )}
          {allowDelete && <button className="kv-delete" title="Remove" onClick={() => remove(row.id)}>
            <Trash2 size={13} />
          </button>}
        </div>
      ))}
    </div>
  );
}
