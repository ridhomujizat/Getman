import type { Auth, Body, KeyValue, Method, SavedResponse, TesApiRequest, TesApiResponse, TreeNode } from '../../types';
import { uid } from '../id.ts';
import { withTrailingBlank } from '../params.ts';
import { syncPathVariables } from '../pathVariables.ts';

interface PostmanItem { name?: unknown; item?: PostmanItem[]; request?: unknown; response?: unknown[] }
interface PostmanCollection { info?: { name?: unknown; schema?: unknown }; item?: PostmanItem[] }

export interface ImportedCollection {
  name: string;
  root: TreeNode[];
  requestCount: number;
  folderCount: number;
  responseCount: number;
  warnings: string[];
}

const METHODS = new Set<Method>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : String(value);
const description = (value: unknown): string => typeof value === 'string' ? value : text(record(value).content);

function rows(value: unknown, fileMode = false): KeyValue[] {
  return withTrailingBlank(list(value).map((raw) => {
    const item = record(raw);
    const isFile = fileMode && item.type === 'file';
    const source = Array.isArray(item.src) ? item.src.map(text).join(', ') : text(item.src);
    return {
      id: uid(),
      key: text(item.key),
      value: isFile ? '' : text(item.value),
      enabled: item.disabled !== true,
      description: description(item.description) || (source ? `Re-select imported file: ${source}` : undefined),
      ...(isFile ? { valueType: 'file' as const, files: [] } : {}),
    };
  }));
}

function urlOf(value: unknown): { url: string; params: KeyValue[]; pathVariables: KeyValue[] } {
  if (typeof value === 'string') return { url: value, params: withTrailingBlank([]), pathVariables: syncPathVariables(value) };
  const url = record(value);
  let raw = text(url.raw);
  if (!raw) {
    const protocol = text(url.protocol);
    const host = Array.isArray(url.host) ? url.host.map(text).join('.') : text(url.host);
    const path = Array.isArray(url.path) ? url.path.map(text).join('/') : text(url.path);
    const port = text(url.port);
    raw = `${protocol ? `${protocol}://` : ''}${host}${port ? `:${port}` : ''}${path ? `/${path}` : ''}`;
  }
  return { url: raw, params: rows(url.query), pathVariables: syncPathVariables(raw, rows(url.variable)) };
}

function bodyOf(value: unknown, warnings: Set<string>): Body {
  const body = record(value);
  const mode = text(body.mode);
  if (!mode) return { type: 'none', raw: '', formData: withTrailingBlank([]) };
  if (mode === 'raw') {
    const language = text(record(record(body.options).raw).language);
    return { type: language === 'json' ? 'json' : 'text', raw: text(body.raw), formData: withTrailingBlank([]) };
  }
  if (mode === 'formdata') {
    if (list(body.formdata).some((item) => record(item).type === 'file')) warnings.add('Imported file fields need their files re-selected.');
    return { type: 'form-data', raw: '', formData: rows(body.formdata, true) };
  }
  if (mode === 'urlencoded') return { type: 'x-www-form-urlencoded', raw: '', formData: rows(body.urlencoded) };
  warnings.add(`Unsupported Postman body mode “${mode}” was imported as text.`);
  return { type: 'text', raw: text(body.raw), formData: withTrailingBlank([]) };
}

function authOf(value: unknown, warnings: Set<string>): Auth {
  const auth = record(value);
  const type = text(auth.type);
  const entries = (key: string) => list(auth[key]).map(record);
  const find = (key: string, name: string) => text(entries(key).find((item) => item.key === name)?.value);
  if (!type || type === 'noauth' || type === 'inherit') return { type: 'none' };
  if (type === 'bearer') return { type: 'bearer', token: find('bearer', 'token') };
  if (type === 'basic') return { type: 'basic', username: find('basic', 'username'), password: find('basic', 'password') };
  if (type === 'apikey') {
    const addTo = find('apikey', 'in') === 'query' ? 'query' : 'header';
    return { type: 'api-key', key: find('apikey', 'key'), value: find('apikey', 'value'), addTo };
  }
  warnings.add(`Unsupported Postman auth type “${type}” was not imported.`);
  return { type: 'none' };
}

function savedResponses(value: unknown): SavedResponse[] {
  return list(value).map((raw, index) => {
    const item = record(raw);
    const body = text(item.body);
    const headers = Object.fromEntries(list(item.header).map(record).filter((header) => text(header.key)).map((header) => [text(header.key).toLowerCase(), text(header.value)]));
    const status = Number(item.code) || 0;
    const response: TesApiResponse = { status, statusText: text(item.status), headers, body, timeMs: Number(item.responseTime) || 0, sizeBytes: new TextEncoder().encode(body).byteLength };
    return { id: uid(), name: text(item.name) || `Response ${index + 1}`, response };
  });
}

function requestNode(item: PostmanItem, warnings: Set<string>): TreeNode | null {
  const value = item.request;
  if (value == null) return null;
  const request = typeof value === 'string' ? { url: value } : record(value);
  const methodValue = text(request.method).toUpperCase() || 'GET';
  const method = METHODS.has(methodValue as Method) ? methodValue as Method : 'GET';
  if (method !== methodValue) warnings.add(`Unsupported HTTP method “${methodValue}” was imported as GET.`);
  const target = urlOf(request.url);
  const name = text(item.name) || `${method} request`;
  const converted: TesApiRequest = {
    id: uid(), name, method, url: target.url, params: target.params, pathVariables: target.pathVariables,
    headers: rows(request.header), body: bodyOf(request.body, warnings), auth: authOf(request.auth, warnings),
  };
  return { id: uid(), type: 'request', name, request: converted, savedResponses: savedResponses(item.response) };
}

export function parsePostmanCollection(value: unknown, fallbackName = 'Imported collection'): ImportedCollection {
  const source = value as PostmanCollection;
  const schema = text(source?.info?.schema);
  if (!source?.info || !Array.isArray(source.item) || !schema.includes('getpostman.com/json/collection')) throw new Error('Unsupported collection format. Choose a Postman Collection v2.0 or v2.1 JSON file.');
  const warnings = new Set<string>();
  let requestCount = 0;
  let folderCount = 0;
  let responseCount = 0;
  const convert = (items: PostmanItem[]): TreeNode[] => items.flatMap((item): TreeNode[] => {
    if (Array.isArray(item.item)) {
      folderCount += 1;
      return [{ id: uid(), type: 'folder' as const, name: text(item.name) || 'Folder', children: convert(item.item) }];
    }
    const node = requestNode(item, warnings);
    if (!node || node.type !== 'request') return [];
    requestCount += 1;
    responseCount += node.savedResponses?.length ?? 0;
    return [node];
  });
  const root = convert(source.item);
  if (!requestCount && !folderCount) throw new Error('The Postman collection is empty.');
  return { name: text(source.info.name) || fallbackName, root, requestCount, folderCount, responseCount, warnings: [...warnings] };
}
