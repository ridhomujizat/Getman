import type { TesApiRequest, KeyValue } from '../../types/index.ts';
import { buildUrl } from '../params.ts';
import { substitutePathVariables } from '../pathVariables.ts';

export interface CurlExportOptions {
  dialect?: 'bash';
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function enabled(rows: KeyValue[] | undefined): KeyValue[] {
  return rows?.filter((row) => row.enabled && row.key) ?? [];
}

function requestUrl(request: TesApiRequest): string {
  if (request.auth.type !== 'api-key' || request.auth.addTo !== 'query' || !request.auth.key) {
    return substitutePathVariables(buildUrl(request.url, request.params), request.pathVariables);
  }
  const params = request.params.filter((param) => param.key !== request.auth.key);
  params.push({ id: 'curl-api-key', key: request.auth.key, value: request.auth.value ?? '', enabled: true });
  return substitutePathVariables(buildUrl(request.url, params), request.pathVariables);
}

export function toCurl(request: TesApiRequest, _options: CurlExportOptions = {}): string {
  const parts: string[] = [];
  if (request.method !== 'GET') parts.push('-X', request.method);
  parts.push(quote(requestUrl(request)));

  for (const header of enabled(request.headers)) {
    if (header.key.toLowerCase() === 'authorization' && (request.auth.type === 'bearer' || request.auth.type === 'basic')) continue;
    parts.push('-H', quote(`${header.key}: ${header.value}`));
  }

  if (request.auth.type === 'bearer') parts.push('-H', quote(`Authorization: Bearer ${request.auth.token ?? ''}`));
  if (request.auth.type === 'basic') parts.push('-u', quote(`${request.auth.username ?? ''}:${request.auth.password ?? ''}`));
  if (request.auth.type === 'api-key' && request.auth.addTo !== 'query' && request.auth.key) {
    parts.push('-H', quote(`${request.auth.key}: ${request.auth.value ?? ''}`));
  }

  if (request.body.type === 'json' || request.body.type === 'text') {
    parts.push('--data-raw', quote(request.body.raw ?? ''));
  } else if (request.body.type === 'x-www-form-urlencoded') {
    for (const item of enabled(request.body.formData)) parts.push('--data-urlencode', quote(`${item.key}=${item.value}`));
  } else if (request.body.type === 'form-data') {
    for (const item of enabled(request.body.formData)) {
      if (item.valueType === 'file') {
        for (const file of item.files ?? []) parts.push('-F', quote(`${item.key}=@${file.name}`));
      } else {
        parts.push('-F', quote(`${item.key}=${item.value}`));
      }
    }
  }

  return ['curl', ...parts].join(' \\\n  ');
}
