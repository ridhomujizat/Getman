import type { Body, BodyType, KeyValue, TesApiRequest } from '../types/index.ts';
import { withTrailingBlank } from './params.ts';
import { syncPathVariables } from './pathVariables.ts';
import { uid } from './id.ts';

const BODY_TYPES = new Set<BodyType>(['none', 'json', 'text', 'form-data', 'x-www-form-urlencoded']);

function inferBodyType(body: Body): BodyType {
  if (BODY_TYPES.has(body.type) && body.type !== 'none') return body.type;
  if ((body.formData ?? []).some((row) => row.enabled && row.key)) return 'form-data';
  const raw = body.raw?.trim() ?? '';
  if (!raw) return 'none';
  try {
    JSON.parse(raw);
    return 'json';
  } catch {
    return 'text';
  }
}

function normalizeBody(body: Body | undefined): Body {
  const source = body ?? { type: 'none' as const };
  const formData = normalizeRows(source.formData ?? []);
  const inferredSource = { ...source, formData };
  const type = BODY_TYPES.has(source.type) ? inferBodyType(inferredSource) : inferBodyType({ ...inferredSource, type: 'none' });
  return { ...source, type, raw: source.raw ?? '', formData: withTrailingBlank(formData) };
}

function normalizeRows(rows: Partial<KeyValue>[]): KeyValue[] {
  return rows.map((row) => ({
    ...row,
    id: row.id || uid(),
    key: row.key ?? '',
    value: row.value ?? '',
    enabled: row.enabled ?? hasContent(row),
  }));
}

function hasContent(row: Partial<KeyValue>): boolean {
  return Boolean(row.key || row.value || row.description || row.valueType === 'file' || row.files?.length);
}

export function normalizeRequestShape(request: TesApiRequest): TesApiRequest {
  const params = normalizeRows(request.params ?? []);
  const headers = normalizeRows(request.headers ?? []);
  const pathVariables = request.pathVariables
    ? syncPathVariables(request.url, normalizeRows(request.pathVariables))
    : undefined;
  return {
    ...request,
    params: withTrailingBlank(params),
    pathVariables,
    headers: withTrailingBlank(headers),
    body: normalizeBody(request.body),
  };
}
