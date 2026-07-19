import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Sidebar } from './components/layout/Sidebar';
import { RequestBuilder } from './components/request/RequestBuilder';
import { ResponseViewer } from './components/response/ResponseViewer';
import { SaveRequestModal } from './components/SaveRequestModal';
import { CloseTabDialog } from './components/CloseTabDialog';
import { Toast, type ToastMessage } from './components/Toast';
import { useRequestStore } from './store/requestStore';
import { useCollectionStore } from './store/collectionStore';
import { activeVariables, useEnvironmentStore } from './store/environmentStore';
import { sendRequest, friendlyError } from './lib/http';
import { isTabDirty, normalizeForCompare } from './lib/collections';
import { uid } from './lib/id';
import { resolveRequest } from './lib/environments';
import { onStorageWarning, storageProvider } from './lib/storage/localJson';
import type { HistoryEntry, SessionState } from './types';

function validUrl(url: string): boolean {
  try {
    const parsed = new URL(url.includes('://') ? url : `http://${url}`);
    return !!parsed.hostname;
  } catch {
    return false;
  }
}

function EmptyRequestState({ onNewRequest }: { onNewRequest: () => void }) {
  return (
    <section className="empty-request-state">
      <div className="empty-request-content">
        <span className="empty-request-label">No request selected</span>
        <button className="empty-request-primary" onClick={onNewRequest}><Plus size={12} /> New request</button>
      </div>
    </section>
  );
}

export default function App() {
  const { request, tabs, activeTabId, loading, setLoading, setResponse, setError, closeTab, createRequest, markSaved, restoreSession } = useRequestStore();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [closeTabId, setCloseTabId] = useState<string | null>(null);
  const [closeAfterSave, setCloseAfterSave] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const inflight = useRef<string | null>(null);
  const hasActiveTab = tabs.some((tab) => tab.id === activeTabId);

  const showToast = useCallback((message: ToastMessage) => setToast(message), []);

  useEffect(() => onStorageWarning((message) => showToast({ title: 'Storage recovered', detail: message, tone: 'error' })), [showToast]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await useCollectionStore.getState().initialize();
        await useEnvironmentStore.getState().initialize();
        const session = await storageProvider.loadSession();
        if (cancelled) return;
        if (session) {
          restoreSession(session);
          for (const id of session.expandedIds ?? []) useCollectionStore.getState().setExpanded(id, true);
        }
        setStorageReady(true);
      } catch (error) {
        if (!cancelled) showToast({ title: 'Local storage unavailable', detail: String(error), tone: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [restoreSession, showToast]);

  useEffect(() => {
    if (!storageReady) return;
    let timer = 0;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const requestState = useRequestStore.getState();
        const collectionState = useCollectionStore.getState();
        const session: SessionState = {
          schemaVersion: 1,
          activeTabId: requestState.activeTabId,
          tabs: requestState.tabs,
          expandedIds: Object.entries(collectionState.expandedIds).filter(([, expanded]) => expanded).map(([id]) => id),
        };
        void storageProvider.saveSession(session).catch((error) => showToast({ title: 'Could not save session', detail: String(error), tone: 'error' }));
      }, 500);
    };
    const unsubscribeTabs = useRequestStore.subscribe(save);
    const unsubscribeCollections = useCollectionStore.subscribe(save);
    save();
    return () => { window.clearTimeout(timer); unsubscribeTabs(); unsubscribeCollections(); };
  }, [showToast, storageReady]);

  const appendHistory = useCallback((entry: HistoryEntry) => {
    void storageProvider.appendHistory(entry)
      .then(() => window.dispatchEvent(new Event('getman-history-updated')))
      .catch((error) => showToast({ title: 'Could not save history', detail: String(error), tone: 'error' }));
  }, [showToast]);

  const onSend = useCallback(async () => {
    const resolved = resolveRequest(request, activeVariables());
    if (resolved.unresolved.length) showToast({ title: 'Unresolved environment variables', detail: resolved.unresolved.join(', '), tone: 'error' });
    const url = resolved.request.url.trim();
    if (!validUrl(url)) {
      setResponse(null);
      setError('Invalid URL — check the address and try again.');
      return;
    }
    const normalized = url.includes('://') ? url : `https://${url}`;
    const sentRequest = { ...resolved.request, url: normalized };
    const token = uid();
    const started = Date.now();
    inflight.current = token;
    setError(null);
    setResponse(null);
    setLoading(true);
    try {
      const response = await sendRequest(sentRequest);
      appendHistory({ id: uid(), ts: new Date().toISOString(), method: sentRequest.method, url: sentRequest.url, status: response.status, durationMs: response.timeMs, sizeBytes: response.sizeBytes, request });
      if (inflight.current === token) setResponse(response);
    } catch (error) {
      appendHistory({ id: uid(), ts: new Date().toISOString(), method: sentRequest.method, url: sentRequest.url, status: 0, durationMs: Date.now() - started, sizeBytes: 0, request });
      if (inflight.current === token) setError(friendlyError(error));
    } finally {
      if (inflight.current === token) setLoading(false);
    }
  }, [appendHistory, request, setError, setLoading, setResponse, showToast]);

  const onCancel = useCallback(() => {
    inflight.current = null;
    setLoading(false);
  }, [setLoading]);

  const saveExisting = useCallback(async (tabId = activeTabId) => {
    const state = useRequestStore.getState();
    const tab = state.tabs.find((item) => item.id === tabId);
    if (!tab?.origin) return false;
    const collections = useCollectionStore.getState();
    await collections.loadCollection(tab.origin.collectionId);
    const collection = useCollectionStore.getState().collectionsById[tab.origin.collectionId];
    const node = collection?.nodesById[tab.origin.nodeId];
    if (!node || node.type !== 'request') throw new Error('Saved request no longer exists.');
    await useCollectionStore.getState().saveRequest(tab.origin.collectionId, node.parentId, tab.draft.name || node.name, tab.draft, tab.origin.nodeId);
    if (state.activeTabId === tabId) state.markSaved(tab.origin, tab.draft.name || node.name);
    else useRequestStore.setState((current) => ({ tabs: current.tabs.map((item) => item.id === tabId ? { ...item, savedSnapshot: normalizeForCompare(tab.draft) } : item) }));
    showToast({ title: 'Request saved' });
    return true;
  }, [activeTabId, showToast]);

  const onSave = useCallback(() => {
    const tab = useRequestStore.getState().tabs.find((item) => item.id === useRequestStore.getState().activeTabId);
    if (!tab || !isTabDirty(tab)) return;
    if (!tab.origin) {
      setSaveOpen(true);
      return;
    }
    void saveExisting().catch((error) => showToast({ title: 'Could not save request', detail: String(error), tone: 'error' }));
  }, [saveExisting, showToast]);

  const requestClose = useCallback((id: string) => {
    const tab = useRequestStore.getState().tabs.find((item) => item.id === id);
    if (!tab) return;
    if (isTabDirty(tab)) setCloseTabId(id);
    else closeTab(id);
  }, [closeTab]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (hasActiveTab && !loading) void onSend();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave();
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        createRequest();
      } else if (event.key.toLowerCase() === 'w') {
        event.preventDefault();
        if (hasActiveTab) requestClose(activeTabId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, createRequest, hasActiveTab, loading, onSave, onSend, requestClose]);

  const closingTab = tabs.find((tab) => tab.id === closeTabId);

  return (
    <div className="shell">
      <Sidebar onToast={showToast} />
      <main className={`main${hasActiveTab ? '' : ' empty-request-main'}`}>
        {hasActiveTab ? <>
          <RequestBuilder onSend={onSend} onCancel={onCancel} onToast={showToast} onSave={onSave} onCloseTab={requestClose} />
          <ResponseViewer onRetry={onSend} />
        </> : <EmptyRequestState onNewRequest={createRequest} />}
      </main>
      <SaveRequestModal
        open={saveOpen}
        request={request}
        onCancel={() => { setSaveOpen(false); setCloseAfterSave(null); }}
        onError={(detail) => showToast({ title: 'Could not save request', detail, tone: 'error' })}
        onSaved={(origin, name) => {
          markSaved(origin, name);
          setSaveOpen(false);
          showToast({ title: 'Saved to collection' });
          if (closeAfterSave) closeTab(closeAfterSave);
          setCloseAfterSave(null);
        }}
      />
      <CloseTabDialog
        open={!!closingTab}
        name={closingTab?.draft.name || 'Untitled request'}
        onCancel={() => setCloseTabId(null)}
        onDiscard={() => { if (closeTabId) closeTab(closeTabId); setCloseTabId(null); }}
        onSave={() => {
          if (!closingTab) return;
          setCloseTabId(null);
          if (!closingTab.origin) {
            useRequestStore.getState().focusTab(closingTab.id);
            setCloseAfterSave(closingTab.id);
            setSaveOpen(true);
          } else {
            void saveExisting(closingTab.id).then(() => closeTab(closingTab.id)).catch((error) => showToast({ title: 'Could not save request', detail: String(error), tone: 'error' }));
          }
        }}
      />
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
