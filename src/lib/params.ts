import type { KeyValue } from '../types';

const uid = () => Math.random().toString(36).slice(2, 10);

export const emptyRow = (): KeyValue => ({ id: uid(), key: '', value: '', enabled: true });

// Ensure the last row is always blank so the editor auto-appends.
export function withTrailingBlank(rows: KeyValue[]): KeyValue[] {
  const last = rows[rows.length - 1];
  if (!last || last.key !== '' || last.value !== '' || (last.files?.length ?? 0) > 0) return [...rows, emptyRow()];
  return rows;
}

// Serialize enabled, non-empty params into `url`'s query string (replacing any existing one).
export function buildUrl(base: string, params: KeyValue[]): string {
  const [path] = base.split('?');
  const active = params.filter((p) => p.enabled && p.key !== '');
  if (active.length === 0) return path;
  const qs = active
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&');
  return `${path}?${qs}`;
}

// Parse a URL's query string into param rows.
export function parseParams(url: string): KeyValue[] {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return [emptyRow()];
  const rows: KeyValue[] = [];
  for (const pair of url.slice(qIdx + 1).split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    rows.push({ id: uid(), key: decodeURIComponent(k), value: decodeURIComponent(v), enabled: true });
  }
  return withTrailingBlank(rows);
}
