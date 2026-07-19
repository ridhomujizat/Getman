import { create } from 'zustand';
import type { GetmanRequest, GetmanResponse, KeyValue, Method } from '../types';
import { buildUrl, emptyRow, parseParams, withTrailingBlank } from '../lib/params';
import { uid } from '../lib/id';

function newRequest(): GetmanRequest {
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

interface State {
  request: GetmanRequest;
  response: GetmanResponse | null;
  error: string | null;
  loading: boolean;
  setMethod: (m: Method) => void;
  setUrl: (url: string) => void;
  setParams: (params: KeyValue[]) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setBody: (body: GetmanRequest['body']) => void;
  setAuth: (auth: GetmanRequest['auth']) => void;
  setResponse: (r: GetmanResponse | null) => void;
  setError: (e: string | null) => void;
  setLoading: (v: boolean) => void;
  replaceRequest: (request: GetmanRequest) => void;
  createRequest: () => void;
}

export const useRequestStore = create<State>((set) => ({
  request: newRequest(),
  response: null,
  error: null,
  loading: false,
  setMethod: (method) => set((s) => ({ request: { ...s.request, method } })),
  setUrl: (url) =>
    set((s) => ({ request: { ...s.request, url, params: parseParams(url) } })),
  setParams: (params) => {
    const rows = withTrailingBlank(params);
    set((s) => ({ request: { ...s.request, params: rows, url: buildUrl(s.request.url, rows) } }));
  },
  setHeaders: (headers) => set((s) => ({ request: { ...s.request, headers: withTrailingBlank(headers) } })),
  setBody: (body) => set((s) => ({
    request: {
      ...s.request,
      body: body.type === 'form-data' ? { ...body, formData: withTrailingBlank(body.formData ?? []) } : body,
    },
  })),
  setAuth: (auth) => set((s) => ({ request: { ...s.request, auth } })),
  setResponse: (response) => set({ response }),
  setError: (error) => set({ error }),
  setLoading: (loading) => set({ loading }),
  replaceRequest: (request) => set({ request, response: null, error: null }),
  createRequest: () => set({ request: newRequest(), response: null, error: null }),
}));
