import type { KeyValue } from '../types/index.ts';
import { uid } from './id.ts';

const PATH_TOKEN_RE = /(^|\/):([A-Za-z_][A-Za-z0-9_-]*)(?=\/|$)/g;

function pathPart(url: string): string {
  const end = url.search(/[?#]/);
  return end < 0 ? url : url.slice(0, end);
}

export function extractPathVariableNames(url: string): string[] {
  const names = new Set<string>();
  for (const match of pathPart(url).matchAll(PATH_TOKEN_RE)) names.add(match[2]);
  return [...names];
}

export function syncPathVariables(url: string, rows: KeyValue[] = []): KeyValue[] {
  const existing = new Map(rows.filter((row) => row.key).map((row) => [row.key, row]));
  return extractPathVariableNames(url).map((key) => existing.get(key) ?? {
    id: uid(),
    key,
    value: '',
    enabled: true,
  });
}

export function substitutePathVariables(url: string, rows: KeyValue[] = []): string {
  const end = url.search(/[?#]/);
  const target = end < 0 ? url : url.slice(0, end);
  const suffix = end < 0 ? '' : url.slice(end);
  const values = new Map(rows.filter((row) => row.enabled && row.key).map((row) => [row.key, row.value]));
  return target.replace(PATH_TOKEN_RE, (token, prefix: string, key: string) => {
    const value = values.get(key);
    return value == null ? token : `${prefix}${encodeURIComponent(value)}`;
  }) + suffix;
}
