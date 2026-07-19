import { create } from 'zustand';
import type { TesApiRequest, TesApiResponse, KeyValue, Method, RequestOrigin, RequestTab, SessionState } from '../types/index.ts';
import { normalizeForCompare } from '../lib/collections.ts';
import { buildUrl, emptyRow, parseParams, withTrailingBlank } from '../lib/params.ts';
import { uid } from '../lib/id.ts';

export function newRequest(): TesApiRequest {
  return {
    id: uid(),
    method: 'GET',
    url: '',
    params: [emptyRow()],
    headers: [emptyRow()],
    body: { type: 'none', raw: '', formData: [emptyRow()] },
    auth: { type: 'none' },
  };
}

function newTab(request = newRequest(), origin: RequestOrigin | null = null): RequestTab {
  return {
    id: uid(),
    draft: request,
    origin,
    savedSnapshot: origin ? normalizeForCompare(request) : null,
  };
}

interface State {
  tabs: RequestTab[];
  activeTabId: string;
  request: TesApiRequest;
  response: TesApiResponse | null;
  error: string | null;
  loading: boolean;
  setMethod: (method: Method) => void;
  setUrl: (url: string) => void;
  setParams: (params: KeyValue[]) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setBody: (body: TesApiRequest['body']) => void;
  setAuth: (auth: TesApiRequest['auth']) => void;
  setResponse: (response: TesApiResponse | null) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  replaceRequest: (request: TesApiRequest) => void;
  createRequest: () => void;
  openRequest: (request: TesApiRequest, origin: RequestOrigin) => void;
  openUnsaved: (request: TesApiRequest) => void;
  focusTab: (id: string) => void;
  closeTab: (id: string) => void;
  renameSavedTab: (origin: RequestOrigin, name: string) => void;
  closeSavedTabs: (collectionId: string, nodeIds?: string[]) => void;
  markSaved: (origin: RequestOrigin, name: string) => void;
  restoreSession: (session: SessionState) => void;
}

const idleRequest = newRequest();

function updateActive(state: State, draft: TesApiRequest): Partial<State> {
  return {
    request: draft,
    tabs: state.tabs.map((tab) => tab.id === state.activeTabId ? { ...tab, draft } : tab),
  };
}

export const useRequestStore = create<State>((set, get) => ({
  tabs: [],
  activeTabId: '',
  request: idleRequest,
  response: null,
  error: null,
  loading: false,
  setMethod: (method) => set((state) => updateActive(state, { ...state.request, method })),
  setUrl: (url) => set((state) => updateActive(state, { ...state.request, url, params: parseParams(url) })),
  setParams: (params) => set((state) => {
    const rows = withTrailingBlank(params);
    return updateActive(state, { ...state.request, params: rows, url: buildUrl(state.request.url, rows) });
  }),
  setHeaders: (headers) => set((state) => updateActive(state, { ...state.request, headers: withTrailingBlank(headers) })),
  setBody: (body) => set((state) => updateActive(state, {
    ...state.request,
    body: body.type === 'form-data' ? { ...body, formData: withTrailingBlank(body.formData ?? []) } : body,
  })),
  setAuth: (auth) => set((state) => updateActive(state, { ...state.request, auth })),
  setResponse: (response) => set({ response }),
  setError: (error) => set({ error }),
  setLoading: (loading) => set({ loading }),
  replaceRequest: (request) => set((state) => ({ ...updateActive(state, request), response: null, error: null })),
  createRequest: () => {
    const tab = newTab();
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id, request: tab.draft, response: null, error: null }));
  },
  openRequest: (request, origin) => {
    const existing = get().tabs.find((tab) => tab.origin?.collectionId === origin.collectionId && tab.origin.nodeId === origin.nodeId);
    if (existing) {
      get().focusTab(existing.id);
      return;
    }
    const tab = newTab(request, origin);
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id, request: tab.draft, response: null, error: null }));
  },
  openUnsaved: (request) => {
    const tab = newTab({ ...request, id: uid() });
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id, request: tab.draft, response: null, error: null }));
  },
  focusTab: (id) => {
    const tab = get().tabs.find((item) => item.id === id);
    if (tab) set({ activeTabId: id, request: tab.draft, response: null, error: null, loading: false });
  },
  closeTab: (id) => set((state) => {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return state;
    const remaining = state.tabs.filter((tab) => tab.id !== id);
    if (!remaining.length) {
      return { tabs: [], activeTabId: '', request: newRequest(), response: null, error: null, loading: false };
    }
    if (state.activeTabId !== id) return { tabs: remaining };
    const next = remaining[Math.min(index, remaining.length - 1)];
    return { tabs: remaining, activeTabId: next.id, request: next.draft, response: null, error: null, loading: false };
  }),
  renameSavedTab: (origin, name) => set((state) => {
    let request = state.request;
    const tabs = state.tabs.map((tab) => {
      if (tab.origin?.collectionId !== origin.collectionId || tab.origin.nodeId !== origin.nodeId) return tab;
      const draft = { ...tab.draft, name };
      if (tab.id === state.activeTabId) request = draft;
      return { ...tab, draft, savedSnapshot: normalizeForCompare(draft) };
    });
    return { tabs, request };
  }),
  closeSavedTabs: (collectionId, nodeIds) => {
    const ids = nodeIds ? new Set(nodeIds) : null;
    for (const tab of get().tabs) {
      if (tab.origin?.collectionId === collectionId && (!ids || ids.has(tab.origin.nodeId))) get().closeTab(tab.id);
    }
  },
  markSaved: (origin, name) => set((state) => {
    const draft = { ...state.request, name };
    const snapshot = normalizeForCompare(draft);
    return {
      request: draft,
      tabs: state.tabs.map((tab) => tab.id === state.activeTabId ? { ...tab, draft, origin, savedSnapshot: snapshot } : tab),
    };
  }),
  restoreSession: (session) => {
    const tabs = session.tabs ?? [];
    const active = tabs.find((tab) => tab.id === session.activeTabId) ?? tabs[0];
    set({ tabs, activeTabId: active?.id ?? '', request: active?.draft ?? newRequest(), response: null, error: null, loading: false });
  },
}));
