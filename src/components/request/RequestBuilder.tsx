import { useState } from 'react';
import { Check, ChevronRight, Copy, Plus, X } from 'lucide-react';
import { useRequestStore } from '../../store/requestStore';
import { methodColor } from '../../lib/methods';
import { toCurl } from '../../lib/curl';
import { UrlBar } from './UrlBar';
import { KeyValueEditor } from './KeyValueEditor';
import { BodyEditor } from './BodyEditor';
import { AuthEditor } from './AuthEditor';

type Tab = 'params' | 'headers' | 'body' | 'auth';

interface Props {
  onSend: () => void;
  onCancel: () => void;
}

const activeCount = (rows: { key: string; enabled: boolean }[]) =>
  rows.filter((r) => r.enabled && r.key !== '').length;

export function RequestBuilder({ onSend, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>('params');
  const [copied, setCopied] = useState(false);
  const { request, setParams, setHeaders, setBody, setAuth, createRequest } = useRequestStore();

  const paramN = activeCount(request.params);
  const headerN = activeCount(request.headers);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'params', label: 'Params', count: paramN || undefined },
    { id: 'headers', label: 'Headers', count: headerN || undefined },
    { id: 'body', label: 'Body' },
    { id: 'auth', label: 'Auth' },
  ];

  return (
    <section className="request-builder">
      <div className="open-tabs">
        <div className="open-tab active">
          <span className="tab-method" style={{ color: methodColor(request.method) }}>{request.method}</span>
          <span>{request.name || 'Untitled request'}</span>
          <X size={12} />
        </div>
        {request.name !== 'Create charge' && <div className="open-tab muted"><span className="tab-method post">POST</span><span>Create charge</span></div>}
        {request.name !== 'Delete user' && <div className="open-tab muted"><span className="tab-method delete">DELETE</span><span>Delete user</span></div>}
        <button className="icon-button new-tab" title="New request" onClick={createRequest}><Plus size={14} /></button>
      </div>

      <div className="breadcrumb">
        <span>My Workspace</span><ChevronRight size={12} /><strong>{request.name || 'Untitled request'}</strong>
        <button
          className="curl-copy"
          onClick={() => {
            navigator.clipboard.writeText(toCurl(request)).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
          title="Copy request as cURL"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'cURL'}
        </button>
      </div>

      <UrlBar onSend={onSend} onCancel={onCancel} />

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count != null && <span className="count"> · {t.count}</span>}
            {t.id === 'auth' && request.auth.type !== 'none' && <span className="count"> ·</span>}
          </button>
        ))}
      </div>

      <div className="pane-body request-pane">
        {tab === 'params' && <KeyValueEditor rows={request.params} onChange={setParams} />}
        {tab === 'headers' && <KeyValueEditor rows={request.headers} onChange={setHeaders} />}
        {tab === 'body' && <BodyEditor body={request.body} onChange={setBody} />}
        {tab === 'auth' && <AuthEditor auth={request.auth} onChange={setAuth} />}
      </div>
    </section>
  );
}
