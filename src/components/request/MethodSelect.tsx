import type { Method } from '../../types';
import { METHODS, methodColor } from '../../lib/methods';
import { ChevronDown } from 'lucide-react';

interface Props {
  value: Method;
  onChange: (m: Method) => void;
}

export function MethodSelect({ value, onChange }: Props) {
  return (
    <div className="method-select" style={{ color: methodColor(value) }}>
      <select
        className="focusable"
        style={{ color: methodColor(value) }}
        value={value}
        onChange={(e) => onChange(e.target.value as Method)}
      >
        {METHODS.map((m) => (
          <option key={m} value={m} style={{ color: '#e6e7ea', background: '#1d1f23' }}>
            {m}
          </option>
        ))}
      </select>
      <ChevronDown className="method-chevron" size={13} />
    </div>
  );
}
