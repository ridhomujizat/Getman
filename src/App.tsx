import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { EnvironmentEditor } from './components/environment/EnvironmentEditor';
import { SecretReviewDialog } from './components/environment/SecretReviewDialog';
import { RequestBuilder } from './components/request/RequestBuilder';
import { EmptyRequestState } from './components/request/EmptyRequestState';
import { ResponseViewer } from './components/response/ResponseViewer';
import { SaveResponseModal } from './components/response/SaveResponseModal';
import { SaveRequestModal } from './components/SaveRequestModal';
import { CloseTabDialog } from './components/CloseTabDialog';
import { CreateWorkspaceModal } from './components/workspace/CreateWorkspaceModal';
import { ManageWorkspacesModal } from './components/workspace/ManageWorkspacesModal';
import { WorkspaceSwitchDialog } from './components/workspace/WorkspaceSwitchDialog';
import { WorkspaceConflictBanner } from './components/workspace/WorkspaceConflictBanner';
import { GitConflictBanner } from './components/workspace/GitConflictBanner';
import { GitIdentityDialog } from './components/workspace/GitIdentityDialog';
import { WorkspaceReadOnlyBanner } from './components/workspace/WorkspaceReadOnlyBanner';
import { WorkspaceSyncBanner } from './components/workspace/WorkspaceSyncBanner';
import { Toast, type ToastMessage } from './components/Toast';
import { useRequestStore } from './store/requestStore';
import { useCollectionStore } from './store/collectionStore';
import { activeVariables } from './store/environmentStore';
import { sendRequest, friendlyError } from './lib/http';
import { isTabDirty, normalizeForCompare } from './lib/collections';
import { uid } from './lib/id';
import { resolveRequest } from './lib/environments';
import { storageProvider } from './lib/storage/localJson';
import { currentSession } from './lib/workspaces/lifecycle';
import { useWorkspaceController } from './hooks/useWorkspaceController';
import { useWorkspaceCollaboration } from './hooks/useWorkspaceCollaboration';
import type { HistoryEntry, SessionState, WorkspaceRecord } from './types';
import { OPEN_VARIABLES_EVENT } from './components/VariablePopover';
import { useGitStore } from './store/gitStore';
import { setSetting } from './lib/registry';
import { useResizableLayout } from './hooks/useResizableLayout';
import type { WorkspaceView } from './components/layout/Sidebar';
import { McpWorkspace } from './components/mcp/McpWorkspace';
import { McpApprovalDialog } from './components/mcp/approval/McpApprovalDialog';
import { getMcpDraftForUi } from './lib/mcp/client';

function validUrl(url: string): boolean {
  try {
    const parsed = new URL(url.includes('://') ? url : `http://${url}`);
    return !!parsed.hostname;
  } catch {
    return false;
  }
}

export default function App() {
  const { request, response, tabs, activeTabId, loading, setLoading, setResponse, setError, closeTab, createRequest, openUnsaved, markSaved } = useRequestStore();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveResponseOpen, setSaveResponseOpen] = useState(false);
  const [saveResponseAfterRequest, setSaveResponseAfterRequest] = useState(false);
  const [closeTabId, setCloseTabId] = useState<string | null>(null);
  const [closeAfterSave, setCloseAfterSave] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('api');
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [manageWorkspacesOpen, setManageWorkspacesOpen] = useState(false);
  const [manageWorkspaceId, setManageWorkspaceId] = useState<string>();
  const [switchTarget, setSwitchTarget] = useState<WorkspaceRecord | null>(null);
  const [switchSaving, setSwitchSaving] = useState(false);
  const [saveForWorkspaceSwitch, setSaveForWorkspaceSwitch] = useState(false);
  const inflight = useRef<string | null>(null);
  const sessionTimer = useRef(0);
  const hasActiveTab = tabs.some((tab) => tab.id === activeTabId);
  const layout = useResizableLayout();

  const showToast = useCallback((message: ToastMessage) => setToast(message), []);
  const workspace = useWorkspaceController(showToast);
  const collaboration = useWorkspaceCollaboration(workspace.current, workspace.ready, workspace.retrySync, showToast);

  useEffect(() => {
    useGitStore.getState().configure(workspace.current);
    if (workspace.ready && workspace.current?.syncType === 'git') void useGitStore.getState().refresh().catch(() => undefined);
  }, [workspace.current?.id, workspace.ready]);

  useEffect(() => {
    const refresh = () => { if (useGitStore.getState().rootPath) void useGitStore.getState().refresh().catch(() => undefined); };
    window.addEventListener('focus', refresh);
    window.addEventListener('tesapi-workspace-saved', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('tesapi-workspace-saved', refresh); };
  }, []);

  useEffect(() => {
    if (!workspace.ready || !workspace.current || storageProvider.isReadOnly()) return;
    const save = () => {
      window.clearTimeout(sessionTimer.current);
      sessionTimer.current = window.setTimeout(() => {
        void storageProvider.saveSession(currentSession()).catch((error) => showToast({ title: 'Could not save session', detail: String(error), tone: 'error' }));
      }, 500);
    };
    const unsubscribeTabs = useRequestStore.subscribe(save);
    const unsubscribeCollections = useCollectionStore.subscribe(save);
    save();
    return () => { window.clearTimeout(sessionTimer.current); unsubscribeTabs(); unsubscribeCollections(); };
  }, [showToast, workspace.current?.id, workspace.ready]);

  const appendHistory = useCallback((entry: HistoryEntry) => {
    if (storageProvider.isReadOnly()) return;
    void storageProvider.appendHistory(entry)
      .then(() => window.dispatchEvent(new Event('tesapi-history-updated')))
      .catch((error) => showToast({ title: 'Could not save history', detail: String(error), tone: 'error' }));
  }, [showToast]);

  const onSend = useCallback(async () => {
    const resolved = resolveRequest(request, activeVariables());
    if (resolved.unresolved.length) showToast({
      title: 'Unresolved environment variables',
      detail: resolved.unresolved.join(', '),
      tone: 'error',
      actionLabel: 'Fix',
      onAction: () => window.dispatchEvent(new Event(OPEN_VARIABLES_EVENT)),
    });
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

  const openNewRequest = useCallback(() => {
    createRequest();
    setWorkspaceView('api');
  }, [createRequest]);

  const saveExisting = useCallback(async (tabId = activeTabId, notify = true) => {
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
    if (notify) showToast({ title: 'Request saved' });
    return true;
  }, [activeTabId, showToast]);

  const switchSession = useCallback((discard: boolean): SessionState => {
    const session = currentSession();
    if (!discard) return session;
    const tabs = session.tabs.filter((tab) => !isTabDirty(tab));
    return { ...session, tabs, activeTabId: tabs.some((tab) => tab.id === session.activeTabId) ? session.activeTabId : tabs[0]?.id ?? '' };
  }, []);

  const performWorkspaceSwitch = useCallback(async (target: WorkspaceRecord, discard = false) => {
    setSwitchSaving(true);
    window.clearTimeout(sessionTimer.current);
    try {
      await workspace.replace(target, switchSession(discard));
      setWorkspaceView('api');
      setSwitchTarget(null);
    } catch (error) {
      showToast({ title: 'Could not switch workspace', detail: String(error), tone: 'error' });
    } finally {
      setSwitchSaving(false);
    }
  }, [showToast, switchSession, workspace]);

  const requestWorkspaceSwitch = useCallback((target: WorkspaceRecord) => {
    if (target.id === workspace.current?.id) return;
    if (useRequestStore.getState().tabs.some(isTabDirty)) setSwitchTarget(target);
    else void performWorkspaceSwitch(target);
  }, [performWorkspaceSwitch, workspace.current?.id]);

  const saveAllForWorkspaceSwitch = useCallback(async () => {
    if (!switchTarget) return;
    setSwitchSaving(true);
    try {
      for (const tab of useRequestStore.getState().tabs.filter((item) => item.origin && isTabDirty(item))) await saveExisting(tab.id, false);
      const unsaved = useRequestStore.getState().tabs.find((tab) => !tab.origin && isTabDirty(tab));
      if (unsaved) {
        useRequestStore.getState().focusTab(unsaved.id);
        setSaveForWorkspaceSwitch(true);
        setSaveOpen(true);
        return;
      }
      await performWorkspaceSwitch(switchTarget);
    } catch (error) {
      showToast({ title: 'Could not save all requests', detail: String(error), tone: 'error' });
    } finally {
      setSwitchSaving(false);
    }
  }, [performWorkspaceSwitch, saveExisting, showToast, switchTarget]);

  const onSave = useCallback(() => {
    const tab = useRequestStore.getState().tabs.find((item) => item.id === useRequestStore.getState().activeTabId);
    if (!tab || !isTabDirty(tab)) return;
    if (!tab.origin) {
      setSaveOpen(true);
      return;
    }
    void saveExisting().catch((error) => showToast({ title: 'Could not save request', detail: String(error), tone: 'error' }));
  }, [saveExisting, showToast]);

  const requestSaveResponse = useCallback(() => {
    const state = useRequestStore.getState();
    if (!state.response) return;
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    if (!tab?.origin) {
      setSaveResponseAfterRequest(true);
      setSaveOpen(true);
      return;
    }
    setSaveResponseOpen(true);
  }, []);

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
        if (workspaceView === 'api' && hasActiveTab && !loading) void onSend();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (workspaceView === 'api') onSave();
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        openNewRequest();
      } else if (event.key.toLowerCase() === 'w') {
        event.preventDefault();
        if (workspaceView === 'api' && hasActiveTab) requestClose(activeTabId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, hasActiveTab, loading, onSave, onSend, openNewRequest, requestClose, workspaceView]);

  useEffect(() => {
    const openDraft = (event: Event) => {
      const draftId = (event as CustomEvent<string>).detail;
      void getMcpDraftForUi(draftId).then((draft) => {
        if (draft.workspaceId !== workspace.current?.id) throw new Error('Switch to the draft workspace before opening it.');
        openUnsaved(draft.request);
        setWorkspaceView('api');
      }).catch((error) => showToast({ title: 'Could not open MCP draft', detail: String(error), tone: 'error' }));
    };
    window.addEventListener('tesapi-open-mcp-draft', openDraft);
    return () => window.removeEventListener('tesapi-open-mcp-draft', openDraft);
  }, [openUnsaved, showToast, workspace.current?.id]);

  const closingTab = tabs.find((tab) => tab.id === closeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeNode = activeTab?.origin ? useCollectionStore.getState().collectionsById[activeTab.origin.collectionId]?.nodesById[activeTab.origin.nodeId] : null;
  const savedResponseNames = activeNode?.type === 'request' ? (activeNode.savedResponses ?? []).map((item) => item.name) : [];

  if (!workspace.current) {
    if (workspace.bootError) return <div className="shell workspace-loading"><section className="workspace-boot-error"><strong>Could not open TesAPI</strong><span>{workspace.bootError}</span><button onClick={() => window.location.reload()}>Retry</button></section></div>;
    return <div className="shell workspace-loading"><span className="spinner accent-spinner" /></div>;
  }

  return (
    <div className="shell" style={{ '--sidebar-width': `${layout.sidebarWidth}px` } as React.CSSProperties}>
      <Sidebar currentWorkspace={workspace.current} workspaces={workspace.workspaces} onToast={showToast} onWorkspaceChange={setWorkspaceView} onCreateWorkspace={() => setCreateWorkspaceOpen(true)} onManageWorkspaces={(target) => { setManageWorkspaceId(target?.id ?? workspace.current?.id); setManageWorkspacesOpen(true); }} onOpenWorkspace={requestWorkspaceSwitch} onOpenWorkspaceWindow={(target) => void workspace.openNewWindow(target).catch((error) => showToast({ title: 'Could not open workspace window', detail: String(error), tone: 'error' }))} onRenameWorkspace={(id, name) => {
        if (storageProvider.isReadOnly()) {
          showToast({ title: 'Workspace is read-only', detail: 'Upgrade TesAPI before renaming this workspace.', tone: 'error' });
          return Promise.resolve();
        }
        return workspace.rename(id, name).catch((error) => { showToast({ title: 'Could not rename workspace', detail: String(error), tone: 'error' }); });
      }} />
      <div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={210} aria-valuemax={440} aria-valuenow={layout.sidebarWidth} tabIndex={0} onPointerDown={layout.startSidebarResize} onDoubleClick={layout.resetSidebar} onKeyDown={(event) => { if (event.key === 'ArrowLeft') layout.resizeSidebarBy(-16); if (event.key === 'ArrowRight') layout.resizeSidebarBy(16); }} />
      <WorkspaceConflictBanner conflict={collaboration.storageConflict} busy={collaboration.storageConflictBusy} onReload={() => void collaboration.resolveStorageConflict(false)} onKeepMine={() => void collaboration.resolveStorageConflict(true)} />
      <WorkspaceReadOnlyBanner reason={storageProvider.readOnlyReason()} />
      <WorkspaceSyncBanner paused={workspace.syncState === 'paused'} busy={collaboration.syncRetryBusy} onRetry={collaboration.retryPausedSync} />
      <GitConflictBanner workspaceRoot={workspace.current.rootPath} manifest={collaboration.gitManifest} busy={collaboration.gitConflictBusy} onResolve={(file, choice) => void collaboration.resolveGitConflict(file, choice)} />
      <main className={`${workspaceView === 'environment' ? 'main environment-main' : workspaceView === 'mcp' ? 'main mcp-main' : `main${hasActiveTab ? ' resizable-main' : ' empty-request-main'}`}`} style={hasActiveTab && workspaceView === 'api' ? { '--response-height': `${layout.responseHeight}px` } as React.CSSProperties : undefined}>
        {workspaceView === 'mcp' ? <McpWorkspace currentWorkspace={workspace.current} workspaces={workspace.workspaces} onToast={showToast} /> : workspaceView === 'environment' ? <EnvironmentEditor onToast={showToast} /> : hasActiveTab ? <>
          <RequestBuilder onSend={onSend} onCancel={onCancel} onToast={showToast} onSave={onSave} onCloseTab={requestClose} />
          <div className="pane-resize-handle" role="separator" aria-orientation="horizontal" aria-label="Resize request and response panes" aria-valuemin={150} aria-valuemax={Math.max(150, window.innerHeight - 266)} aria-valuenow={layout.responseHeight} tabIndex={0} onPointerDown={layout.startResponseResize} onDoubleClick={layout.resetResponse} onKeyDown={(event) => { if (event.key === 'ArrowUp') layout.resizeResponseBy(16); if (event.key === 'ArrowDown') layout.resizeResponseBy(-16); }} />
          <ResponseViewer onRetry={onSend} onSaveResponse={requestSaveResponse} />
        </> : <EmptyRequestState onNewRequest={openNewRequest} />}
      </main>
      <SaveRequestModal
        open={saveOpen}
        request={request}
        onCancel={() => { setSaveOpen(false); setCloseAfterSave(null); setSaveResponseAfterRequest(false); if (saveForWorkspaceSwitch) { setSaveForWorkspaceSwitch(false); setSwitchTarget(null); } }}
        onError={(detail) => showToast({ title: 'Could not save request', detail, tone: 'error' })}
        onSaved={(origin, name) => {
          markSaved(origin, name);
          setSaveOpen(false);
          showToast({ title: 'Saved to collection' });
          if (closeAfterSave) closeTab(closeAfterSave);
          setCloseAfterSave(null);
          if (saveForWorkspaceSwitch) {
            setSaveForWorkspaceSwitch(false);
            window.queueMicrotask(() => { void saveAllForWorkspaceSwitch(); });
          }
          if (saveResponseAfterRequest) {
            setSaveResponseAfterRequest(false);
            window.queueMicrotask(() => setSaveResponseOpen(true));
          }
        }}
      />
      <SaveResponseModal
        open={saveResponseOpen}
        requestName={activeTab?.draft.name ?? activeNode?.name ?? 'Untitled request'}
        response={response}
        existingNames={savedResponseNames}
        onCancel={() => setSaveResponseOpen(false)}
        onSave={async (name) => {
          const state = useRequestStore.getState();
          const tab = state.tabs.find((item) => item.id === state.activeTabId);
          if (!tab?.origin || !state.response) throw new Error('The request or response is no longer available.');
          await useCollectionStore.getState().loadCollection(tab.origin.collectionId);
          await useCollectionStore.getState().saveResponse(tab.origin.collectionId, tab.origin.nodeId, name, state.response);
          setSaveResponseOpen(false);
          showToast({ title: 'Response saved', detail: `Added “${name}” below the request.` });
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
      <CreateWorkspaceModal open={createWorkspaceOpen} onCancel={() => setCreateWorkspaceOpen(false)} onCreate={workspace.create} onCreated={(created) => { setCreateWorkspaceOpen(false); requestWorkspaceSwitch(created); }} />
      <ManageWorkspacesModal
        open={manageWorkspacesOpen}
        currentId={workspace.current.id}
        initialWorkspaceId={manageWorkspaceId}
        workspaces={workspace.workspaces}
        onClose={() => setManageWorkspacesOpen(false)}
        onCreate={() => { setManageWorkspacesOpen(false); setCreateWorkspaceOpen(true); }}
        onOpenHere={(target) => { setManageWorkspacesOpen(false); requestWorkspaceSwitch(target); }}
        onOpenWindow={(target) => { setManageWorkspacesOpen(false); void workspace.openNewWindow(target).catch((error) => showToast({ title: 'Could not open workspace window', detail: String(error), tone: 'error' })); }}
        onRename={workspace.rename}
        onDelete={async (id) => { await workspace.remove(id); showToast({ title: 'Workspace removed', detail: 'Its files remain on disk.' }); }}
        onAutoCommitChange={async (id, enabled) => { await setSetting(`workspace:${id}:autoCommitOnSave`, enabled); if (id === workspace.current?.id) storageProvider.enableGitSync(enabled); showToast({ title: enabled ? 'Auto-commit enabled' : 'Manual commits enabled' }); }}
      />
      <WorkspaceSwitchDialog open={!!switchTarget && !saveForWorkspaceSwitch} workspaceName={switchTarget?.name ?? ''} saving={switchSaving} onCancel={() => setSwitchTarget(null)} onDiscard={() => { if (switchTarget) void performWorkspaceSwitch(switchTarget, true); }} onSaveAll={() => void saveAllForWorkspaceSwitch()} />
      <McpApprovalDialog workspaceId={workspace.current.id} onToast={showToast} />
      <SecretReviewDialog review={collaboration.secretReview} busy={collaboration.secretReviewBusy} error={collaboration.secretReviewError} onComplete={(choice) => void collaboration.completeSecretReview(choice)} />
      <GitIdentityDialog open={collaboration.identityOpen} busy={collaboration.identityBusy} error={collaboration.identityError} onSave={(name, email) => void collaboration.saveIdentity(name, email)} />
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
