import { useEffect, useState } from 'react';
import { ChevronRight, Copy, Plus, Save, X } from 'lucide-react';
import { useRequestStore } from '../../store/requestStore';
import { useCollectionStore } from '../../store/collectionStore';
import { useEnvironmentStore } from '../../store/environmentStore';
import { isTabDirty } from '../../lib/collections';
import { resolveRequest } from '../../lib/environments';
import { methodColor } from '../../lib/methods';
import { toCurl } from '../../lib/curl';
import { UrlBar } from './UrlBar';
import { KeyValueEditor } from './KeyValueEditor';
import { BodyEditor } from './BodyEditor';
import { AuthEditor } from './AuthEditor';
import type { ToastMessage } from '../Toast';
import { VariablesPanel } from '../VariablesPanel';
import { useRequestVariables } from '../../store/variableStatus';
import { OPEN_VARIABLES_EVENT } from '../VariablePopover';
import { syncPathVariables } from '../../lib/pathVariables';

type Tab = 'params' | 'headers' | 'body' | 'auth';

interface Props {
  onSend: () => void;
  onCancel: () => void;
  onToast: (message: ToastMessage) => void;
  onSave: () => void;
  onCloseTab: (id: string) => void;
}

const activeCount = (rows: { key: string; enabled: boolean }[]) =>
  rows.filter((r) => r.enabled && r.key !== '').length;

export function RequestBuilder({ onSend, onCancel, onToast, onSave, onCloseTab }: Props) {
  const [tab, setTab] = useState<Tab>('params');
  const [variablesOpen, setVariablesOpen] = useState(false);
  const { request, tabs: openTabs, activeTabId, focusTab, setParams, setPathVariables, setHeaders, setBody, setAuth, createRequest } = useRequestStore();
  const summaries = useCollectionStore((state) => state.summaries);
  const environmentFile = useEnvironmentStore((state) => state.file);
  const setActiveEnvironment = useEnvironmentStore((state) => state.setActive);
  const activeRequestTab = openTabs.find((item) => item.id === activeTabId)!;
  const dirty = isTabDirty(activeRequestTab);
  const collectionName = activeRequestTab.origin
    ? summaries.find((summary) => summary.id === activeRequestTab.origin?.collectionId)?.name
    : null;

  const pathVariables = syncPathVariables(request.url, request.pathVariables);
  const paramN = activeCount(request.params) + activeCount(pathVariables);
  const headerN = activeCount(request.headers);
  const requestVariableStatuses = useRequestVariables(request);

  useEffect(() => {
    const openVariables = () => setVariablesOpen(true);
    window.addEventListener(OPEN_VARIABLES_EVENT, openVariables);
    return () => window.removeEventListener(OPEN_VARIABLES_EVENT, openVariables);
  }, []);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'params', label: 'Params', count: paramN || undefined },
    { id: 'headers', label: 'Headers', count: headerN || undefined },
    { id: 'body', label: 'Body' },
    { id: 'auth', label: 'Auth' },
  ];

  return (
    <section className="request-builder">
      <div className="open-tabs">
        {openTabs.map((requestTab) => (
          <div
            className={`open-tab${requestTab.id === activeTabId ? ' active' : ' muted'}`}
            key={requestTab.id}
            role="button"
            tabIndex={0}
            onClick={() => focusTab(requestTab.id)}
            onKeyDown={(event) => { if (event.key === 'Enter') focusTab(requestTab.id); }}
            onAuxClick={(event) => { if (event.button === 1) onCloseTab(requestTab.id); }}
          >
            <span className="tab-method" style={{ color: methodColor(requestTab.draft.method) }}>{requestTab.draft.method}</span>
            <span className="open-tab-name">{requestTab.draft.name || 'Untitled request'}</span>
            {isTabDirty(requestTab) && <i className="dirty-dot" />}
            <button className="tab-close" title="Close tab" onClick={(event) => { event.stopPropagation(); onCloseTab(requestTab.id); }}><X size={12} /></button>
          </div>
        ))}
        <button className="icon-button new-tab" title="New request" onClick={createRequest}><Plus size={14} /></button>
      </div>

      <div className="breadcrumb">
        <span>{collectionName || 'My Workspace'}</span><ChevronRight size={12} /><strong>{request.name || 'Untitled request'}</strong>
        <select className="environment-select" aria-label="Active environment" value={environmentFile.activeEnvironmentId ?? ''} onChange={(event) => void setActiveEnvironment(event.target.value || null)}><option value="">No environment</option>{environmentFile.environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select>
        <button
          className="curl-copy"
          title="Copy request as cURL"
          onClick={() => {
            const variables = environmentFile.environments.find((environment) => environment.id === environmentFile.activeEnvironmentId)?.variables ?? [];
            const resolved = resolveRequest(request, variables);
            if (resolved.unresolved.length) onToast({ title: 'Unresolved environment variables', detail: resolved.unresolved.join(', '), tone: 'error' });
            const copy = navigator.clipboard?.writeText(toCurl(resolved.request));
            if (!copy) {
              onToast({ title: 'Could not copy cURL', tone: 'error' });
              return;
            }
            copy.then(() => onToast({ title: 'Copied as cURL' })).catch(() => onToast({ title: 'Could not copy cURL', tone: 'error' }));
          }}
        >
          <Copy size={12} /> cURL
        </button>
        <button className="request-save-button" disabled={!dirty} onClick={onSave}><Save size={12} /> Save</button>
      </div>

      <UrlBar onSend={onSend} onCancel={onCancel} onToast={onToast} />

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
        {tab === 'params' && <div className="params-editor">
          <section className="params-section">
            <h3>Query Params</h3>
            <KeyValueEditor rows={request.params} onChange={setParams} />
          </section>
          <section className="params-section">
            <h3>Path Variables</h3>
            <KeyValueEditor rows={pathVariables} onChange={setPathVariables} readOnlyKeys allowDelete={false} />
          </section>
        </div>}
        {tab === 'headers' && <KeyValueEditor rows={request.headers} onChange={setHeaders} />}
        {tab === 'body' && <BodyEditor body={request.body} onChange={setBody} />}
        {tab === 'auth' && <AuthEditor auth={request.auth} onChange={setAuth} />}
      </div>
      <VariablesPanel open={variablesOpen} variables={requestVariableStatuses} onClose={() => setVariablesOpen(false)} />
    </section>
  );
}
