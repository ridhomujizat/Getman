import type { Auth, BodyType, TesApiRequest, KeyValue, Method } from '../../types/index.ts';
import { uid } from '../id.ts';
import { emptyRow, withTrailingBlank } from '../params.ts';

export type CurlParseResult =
  | { ok: true; request: TesApiRequest; warnings: string[] }
  | { ok: false; error: string };

interface MapState {
  url: string;
  requestedMethod?: Method;
  forceGet: boolean;
  head: boolean;
  headers: KeyValue[];
  auth: Auth;
  data: string[];
  formData: KeyValue[];
  hasJsonFlag: boolean;
  warnings: string[];
}

interface FlagDefinition {
  flags: string[];
  takesValue: boolean;
  apply: (state: MapState, value?: string) => void;
}

const METHODS = new Set<Method>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const SILENT_FLAGS = new Set(['--compressed', '-s', '-k', '--insecure', '-L', '--location', '-v']);
const UNSUPPORTED_VALUE_FLAGS = new Set([
  '--cacert', '--cert', '--connect-timeout', '--key', '--max-time', '-o', '--output',
  '--proxy', '--resolve', '--retry', '--retry-delay',
]);

const row = (key: string, value: string): KeyValue => ({ id: uid(), key, value, enabled: true });
const warn = (state: MapState, message: string) => {
  if (!state.warnings.includes(message)) state.warnings.push(message);
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function queryRows(query: string): KeyValue[] {
  return query.split('&').filter(Boolean).map((pair) => {
    const split = pair.indexOf('=');
    const key = split < 0 ? pair : pair.slice(0, split);
    const value = split < 0 ? '' : pair.slice(split + 1);
    return row(safeDecode(key), safeDecode(value));
  });
}

function paramsFromUrl(url: string): KeyValue[] {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return [];
  const fragmentStart = url.indexOf('#', queryStart);
  return queryRows(url.slice(queryStart + 1, fragmentStart < 0 ? undefined : fragmentStart));
}

function appendQuery(url: string, query: string): string {
  if (!query) return url;
  const fragmentStart = url.indexOf('#');
  const fragment = fragmentStart < 0 ? '' : url.slice(fragmentStart);
  const base = fragmentStart < 0 ? url : url.slice(0, fragmentStart);
  const separator = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${separator}${query}${fragment}`;
}

function setHeader(state: MapState, key: string, value: string): void {
  const existing = state.headers.find((header) => header.key.toLowerCase() === key.toLowerCase());
  if (existing) existing.value = value;
  else state.headers.push(row(key, value));
}

function decodeBasic(value: string): Auth | null {
  try {
    const decoded = atob(value.trim());
    const split = decoded.indexOf(':');
    if (split < 0) return null;
    return { type: 'basic', username: decoded.slice(0, split), password: decoded.slice(split + 1) };
  } catch {
    return null;
  }
}

function addHeader(state: MapState, value = ''): void {
  const split = value.indexOf(':');
  const key = (split < 0 ? value.replace(/;$/, '') : value.slice(0, split)).trim();
  const headerValue = split < 0 ? '' : value.slice(split + 1).trim();
  if (!key) return;

  if (key.toLowerCase() === 'authorization') {
    const bearer = headerValue.match(/^Bearer\s+(.+)$/i);
    if (bearer) {
      state.auth = { type: 'bearer', token: bearer[1] };
      return;
    }
    const basic = headerValue.match(/^Basic\s+(.+)$/i);
    const auth = basic ? decodeBasic(basic[1]) : null;
    if (auth) {
      state.auth = auth;
      return;
    }
  }
  state.headers.push(row(key, headerValue));
}

function addFormData(state: MapState, value = ''): void {
  const split = value.indexOf('=');
  const key = (split < 0 ? value : value.slice(0, split)).trim();
  const formValue = split < 0 ? '' : value.slice(split + 1);
  if (!key) return;

  if (formValue.startsWith('@')) {
    const path = formValue.slice(1).split(';', 1)[0].replace(/^['"]|['"]$/g, '');
    const name = path.split(/[\\/]/).pop() || 'file';
    const file = { name, mimeType: '', sizeBytes: 0, data: [] };
    const existing = state.formData.find((item) => item.key === key && item.valueType === 'file');
    if (existing) existing.files = [...(existing.files ?? []), file];
    else state.formData.push({ ...row(key, ''), valueType: 'file', files: [file] });
  } else {
    state.formData.push(row(key, formValue));
  }
}

function urlEncodeData(value = ''): string {
  const split = value.indexOf('=');
  if (split < 0) return encodeURIComponent(value);
  return `${value.slice(0, split)}=${encodeURIComponent(value.slice(split + 1))}`;
}

const FLAGS: FlagDefinition[] = [
  { flags: ['--url'], takesValue: true, apply: (state, value) => { state.url = value ?? ''; } },
  { flags: ['-X', '--request'], takesValue: true, apply: (state, value) => {
    const method = value?.toUpperCase() as Method;
    if (METHODS.has(method)) state.requestedMethod = method;
    else warn(state, `Unsupported request method: ${value ?? ''}`);
  } },
  { flags: ['-H', '--header'], takesValue: true, apply: addHeader },
  { flags: ['-b', '--cookie'], takesValue: true, apply: (state, value) => addHeader(state, `Cookie: ${value ?? ''}`) },
  { flags: ['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'], takesValue: true, apply: (state, value) => { state.data.push(value ?? ''); } },
  { flags: ['--data-urlencode'], takesValue: true, apply: (state, value) => { state.data.push(urlEncodeData(value)); } },
  { flags: ['-F', '--form'], takesValue: true, apply: addFormData },
  { flags: ['-u', '--user'], takesValue: true, apply: (state, value) => {
    const split = (value ?? '').indexOf(':');
    state.auth = {
      type: 'basic',
      username: split < 0 ? value ?? '' : (value ?? '').slice(0, split),
      password: split < 0 ? '' : (value ?? '').slice(split + 1),
    };
  } },
  { flags: ['-G', '--get'], takesValue: false, apply: (state) => { state.forceGet = true; } },
  { flags: ['-A', '--user-agent'], takesValue: true, apply: (state, value) => addHeader(state, `User-Agent: ${value ?? ''}`) },
  { flags: ['-e', '--referer'], takesValue: true, apply: (state, value) => addHeader(state, `Referer: ${value ?? ''}`) },
  { flags: ['--json'], takesValue: true, apply: (state, value) => {
    state.hasJsonFlag = true;
    state.data.push(value ?? '');
    setHeader(state, 'Content-Type', 'application/json');
    setHeader(state, 'Accept', 'application/json');
  } },
  { flags: ['-I', '--head'], takesValue: false, apply: (state) => { state.head = true; } },
];

function findFlag(arg: string): { definition: FlagDefinition; value?: string } | null {
  for (const definition of FLAGS) {
    if (definition.flags.includes(arg)) return { definition };
    const short = definition.flags.find((flag) => flag.startsWith('-') && !flag.startsWith('--'));
    if (definition.takesValue && short && arg.startsWith(short) && arg.length > short.length) {
      return { definition, value: arg.slice(short.length) };
    }
  }
  return null;
}

function inferBodyType(state: MapState, raw: string): BodyType {
  if (state.formData.length) return 'form-data';
  if (!state.data.length) return 'none';
  const contentType = state.headers.find((header) => header.key.toLowerCase() === 'content-type')?.value.toLowerCase();
  if (state.hasJsonFlag || contentType?.includes('json') || /^[\[{]/.test(raw.trim())) return 'json';
  if (contentType?.includes('application/x-www-form-urlencoded') || /^(?:[^=&]+=[^&]*)(?:&[^=&]+=[^&]*)*$/.test(raw)) {
    return 'x-www-form-urlencoded';
  }
  return 'text';
}

export function mapCurlArgs(argv: string[]): CurlParseResult {
  const executable = argv[0]?.toLowerCase();
  if (executable !== 'curl' && executable !== 'curl.exe') return { ok: false, error: 'Input is not a cURL command.' };

  const state: MapState = {
    url: '',
    forceGet: false,
    head: false,
    headers: [],
    auth: { type: 'none' },
    data: [],
    formData: [],
    hasJsonFlag: false,
    warnings: [],
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const match = findFlag(arg);
    if (match) {
      let value = match.value;
      if (match.definition.takesValue && value == null) {
        value = argv[i + 1];
        if (value == null) return { ok: false, error: `Flag ${arg} requires a value.` };
        i += 1;
      }
      match.definition.apply(state, value);
    } else if (SILENT_FLAGS.has(arg)) {
      // Intentionally ignored cURL transport option.
    } else if (arg.startsWith('-')) {
      warn(state, `Ignored unsupported flag: ${arg}`);
      if (UNSUPPORTED_VALUE_FLAGS.has(arg) && argv[i + 1] != null) i += 1;
    } else if (!state.url) {
      state.url = arg;
    }
  }

  if (!state.url) return { ok: false, error: 'cURL command is missing a URL.' };

  const raw = state.data.join('&');
  let params = paramsFromUrl(state.url);
  if (state.forceGet && raw) {
    params = [...params, ...queryRows(raw)];
    state.url = appendQuery(state.url, raw);
  }
  const bodyType = state.forceGet ? 'none' : inferBodyType(state, raw);
  const method = state.forceGet
    ? 'GET'
    : state.head
      ? 'HEAD'
      : state.requestedMethod ?? (bodyType === 'none' ? 'GET' : 'POST');
  const formData = bodyType === 'x-www-form-urlencoded' ? queryRows(raw) : state.formData;

  return {
    ok: true,
    warnings: state.warnings,
    request: {
      id: uid(),
      method,
      url: state.url,
      params: withTrailingBlank(params),
      headers: withTrailingBlank(state.headers),
      body: {
        type: bodyType,
        raw: bodyType === 'json' || bodyType === 'text' ? raw : '',
        formData: withTrailingBlank(formData.length ? formData : [emptyRow()]),
      },
      auth: state.auth,
    },
  };
}
