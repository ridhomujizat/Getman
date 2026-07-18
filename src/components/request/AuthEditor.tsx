import { Info } from 'lucide-react';
import type { Auth } from '../../types';

interface Props {
  auth: Auth;
  onChange: (auth: Auth) => void;
}

export function AuthEditor({ auth, onChange }: Props) {
  const set = (patch: Partial<Auth>) => onChange({ ...auth, ...patch });

  return (
    <div className="auth-form">
      <div className="field">
        <label className="label-caps">Type</label>
        <select value={auth.type} onChange={(e) => set({ type: e.target.value as Auth['type'] })}>
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="api-key">API Key</option>
        </select>
      </div>

      {auth.type === 'bearer' && (
        <>
          <div className="field">
            <label>Token</label>
            <input
              value={auth.token ?? ''}
              onChange={(e) => set({ token: e.target.value })}
              placeholder="token"
            />
          </div>
          <div className="auth-hint">
            <Info size={14} />
            <span>Injected as <code>Authorization: Bearer …</code> at send time — not stored in the Headers list.</span>
          </div>
        </>
      )}

      {auth.type === 'basic' && (
        <>
          <div className="field">
            <label className="label-caps">Username</label>
            <input value={auth.username ?? ''} onChange={(e) => set({ username: e.target.value })} />
          </div>
          <div className="field">
            <label className="label-caps">Password</label>
            <input
              type="password"
              value={auth.password ?? ''}
              onChange={(e) => set({ password: e.target.value })}
            />
          </div>
        </>
      )}

      {auth.type === 'api-key' && (
        <>
          <div className="field">
            <label className="label-caps">Key</label>
            <input value={auth.key ?? ''} onChange={(e) => set({ key: e.target.value })} />
          </div>
          <div className="field">
            <label className="label-caps">Value</label>
            <input value={auth.value ?? ''} onChange={(e) => set({ value: e.target.value })} />
          </div>
          <div className="field">
            <label className="label-caps">Add to</label>
            <select
              value={auth.addTo ?? 'header'}
              onChange={(e) => set({ addTo: e.target.value as Auth['addTo'] })}
            >
              <option value="header">Header</option>
              <option value="query">Query Param</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}
