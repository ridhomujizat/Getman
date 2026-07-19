import type { GetmanRequest, KeyValue, Method } from '../types/index.ts';
import { uid } from './id.ts';
import { emptyRow, parseParams, withTrailingBlank } from './params.ts';

const METHODS = new Set<Method>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function tokens(command: string): string[] {
  const out: string[] = [];
  let token = '';
  let quote = '';
  let escaped = false;

  for (const char of command.replace(/\\\r?\n/g, ' ')) {
    if (escaped) {
      token += char;
      escaped = false;
    } else if (char === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = '';
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (token) out.push(token);
      token = '';
    } else {
      token += char;
    }
  }
  if (token) out.push(token);
  return out;
}

function row(key: string, value: string): KeyValue {
  return { id: uid(), key, value, enabled: true };
}

export function parseCurl(command: string): GetmanRequest | null {
  const args = tokens(command.trim());
  if (args[0]?.toLowerCase() !== 'curl') return null;

  let method: Method = 'GET';
  let url = '';
  let raw = '';
  let bodyType: GetmanRequest['body']['type'] = 'none';
  let auth: GetmanRequest['auth'] = { type: 'none' };
  const headers: KeyValue[] = [];
  const formData: KeyValue[] = [];

  const take = (i: number) => args[i + 1] ?? '';
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-X' || arg === '--request') {
      const next = take(i).toUpperCase() as Method;
      if (METHODS.has(next)) method = next;
      i += 1;
    } else if (arg === '-H' || arg === '--header') {
      const value = take(i);
      const split = value.indexOf(':');
      headers.push(row(value.slice(0, split).trim(), value.slice(split + 1).trim()));
      i += 1;
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(arg)) {
      raw = take(i);
      bodyType = 'text';
      if (method === 'GET') method = 'POST';
      i += 1;
    } else if (arg === '-F' || arg === '--form') {
      const value = take(i);
      const split = value.indexOf('=');
      const key = value.slice(0, split);
      const formValue = value.slice(split + 1);
      if (formValue.startsWith('@')) {
        const name = formValue.slice(1).split('/').pop() || 'file';
        const file = { name, mimeType: '', sizeBytes: 0, data: [] };
        const existing = formData.find((item) => item.key === key && item.valueType === 'file');
        if (existing) existing.files = [...(existing.files ?? []), file];
        else formData.push({ ...row(key, ''), valueType: 'file', files: [file] });
      } else {
        formData.push(row(key, formValue));
      }
      bodyType = 'form-data';
      if (method === 'GET') method = 'POST';
      i += 1;
    } else if (arg === '-u' || arg === '--user') {
      const [username, ...password] = take(i).split(':');
      auth = { type: 'basic', username, password: password.join(':') };
      i += 1;
    } else if (!arg.startsWith('-') && /^https?:\/\//i.test(arg)) {
      url = arg;
    }
  }

  const contentType = headers.find((header) => header.key.toLowerCase() === 'content-type')?.value;
  if (bodyType === 'text' && (contentType?.includes('json') || /^[\[{]/.test(raw.trim()))) {
    bodyType = 'json';
  }

  if (!url) return null;
  return {
    id: uid(),
    method,
    url,
    params: parseParams(url),
    headers: withTrailingBlank(headers.length ? headers : [emptyRow()]),
    body: { type: bodyType, raw, formData: withTrailingBlank(formData.length ? formData : [emptyRow()]) },
    auth,
  };
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function toCurl(request: GetmanRequest): string {
  let url = request.url;
  if (request.auth.type === 'api-key' && request.auth.addTo === 'query' && request.auth.key) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set(request.auth.key, request.auth.value ?? '');
      url = parsed.toString();
    } catch {
      // Keep the editable URL as-is; validation happens when the request is sent.
    }
  }
  const parts = ['curl', '-X', request.method, quote(url)];
  for (const header of request.headers.filter((item) => item.enabled && item.key)) {
    parts.push('-H', quote(`${header.key}: ${header.value}`));
  }
  if (request.auth.type === 'bearer') parts.push('-H', quote(`Authorization: Bearer ${request.auth.token ?? ''}`));
  if (request.auth.type === 'basic') parts.push('-u', quote(`${request.auth.username ?? ''}:${request.auth.password ?? ''}`));
  if (request.auth.type === 'api-key') {
    const value = `${request.auth.key ?? ''}: ${request.auth.value ?? ''}`;
    if (request.auth.addTo !== 'query') parts.push('-H', quote(value));
  }
  if (request.body.type === 'json' || request.body.type === 'text') parts.push('--data-raw', quote(request.body.raw ?? ''));
  if (request.body.type === 'form-data') {
    for (const item of request.body.formData?.filter((entry) => entry.enabled && entry.key) ?? []) {
      if (item.valueType === 'file') {
        for (const file of item.files ?? []) parts.push('-F', quote(`${item.key}=@${file.name}`));
      } else {
        parts.push('-F', quote(`${item.key}=${item.value}`));
      }
    }
  }
  return parts.join(' ');
}
