import type { EnvironmentsFile, KeyValue, TesApiRequest } from '../types';

/** The placeholder grammar shared by highlighting and send-time substitution. */
export const VAR_TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export type VarSpan =
  | { text: string; start: number; end: number }
  | { varName: string; start: number; end: number };

export type VarStatus = {
  name: string;
  state: 'resolved' | 'unresolved';
  value?: string;
  envName?: string;
  reason?: 'no-environment' | 'missing' | 'disabled';
};

function tokenRegex(): RegExp {
  return new RegExp(VAR_TOKEN_RE.source, VAR_TOKEN_RE.flags);
}

export function splitVarSpans(text: string): VarSpan[] {
  if (!text.includes('{{')) return [{ text, start: 0, end: text.length }];
  const spans: VarSpan[] = [];
  let cursor = 0;
  for (const match of text.matchAll(tokenRegex())) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > cursor) spans.push({ text: text.slice(cursor, start), start: cursor, end: start });
    spans.push({ varName: match[1].trim(), start, end });
    cursor = end;
  }
  if (cursor < text.length || !spans.length) spans.push({ text: text.slice(cursor), start: cursor, end: text.length });
  return spans;
}

function activeEnvironment(file: EnvironmentsFile) {
  return file.environments.find((environment) => environment.id === file.activeEnvironmentId);
}

export function resolveVarStatus(name: string, file: EnvironmentsFile): VarStatus {
  const environment = activeEnvironment(file);
  if (!environment) return { name, state: 'unresolved', reason: 'no-environment' };
  const row = environment.variables.find((item) => item.key.trim() === name);
  if (!row) return { name, state: 'unresolved', envName: environment.name, reason: 'missing' };
  if (!row.enabled) return { name, state: 'unresolved', envName: environment.name, reason: 'disabled' };
  return { name, state: 'resolved', value: row.value, envName: environment.name };
}

let cachedEnvironmentId: string | null | undefined;
let cachedVariables: KeyValue[] | null = null;
let cachedEnvironmentMap = new Map<string, KeyValue>();
let cachedMap = new Map<string, VarStatus>();

/** Reuses the active environment index while the store's variable array is unchanged. */
export function activeEnvironmentMap(file: EnvironmentsFile): Map<string, KeyValue> {
  const variables = activeEnvironment(file)?.variables ?? [];
  if (cachedEnvironmentId === file.activeEnvironmentId && cachedVariables === variables) return cachedEnvironmentMap;
  cachedEnvironmentId = file.activeEnvironmentId;
  cachedVariables = variables;
  cachedEnvironmentMap = new Map(variables.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item]));
  cachedMap = new Map();
  return cachedEnvironmentMap;
}

export function variableStatusMap(file: EnvironmentsFile): Map<string, VarStatus> {
  activeEnvironmentMap(file);
  return cachedMap;
}

export function statusFor(name: string, file: EnvironmentsFile): VarStatus {
  const map = variableStatusMap(file);
  const cached = map.get(name);
  if (cached) return cached;
  const environment = activeEnvironment(file);
  const row = activeEnvironmentMap(file).get(name);
  const status: VarStatus = !environment
    ? { name, state: 'unresolved', reason: 'no-environment' }
    : !row
      ? { name, state: 'unresolved', envName: environment.name, reason: 'missing' }
      : !row.enabled
        ? { name, state: 'unresolved', envName: environment.name, reason: 'disabled' }
        : { name, state: 'resolved', value: row.value, envName: environment.name };
  map.set(name, status);
  return status;
}

function collect(text: string, names: Set<string>): void {
  for (const span of splitVarSpans(text)) if ('varName' in span) names.add(span.varName);
}

export function requestVariableNames(request: TesApiRequest): string[] {
  const names = new Set<string>();
  collect(request.url, names);
  for (const row of [...request.params, ...(request.pathVariables ?? []), ...request.headers, ...(request.body.formData ?? [])]) {
    collect(row.key, names);
    collect(row.value, names);
  }
  collect(request.body.raw ?? '', names);
  for (const value of [request.auth.token, request.auth.username, request.auth.password, request.auth.key, request.auth.value]) {
    if (value) collect(value, names);
  }
  return [...names];
}

export function requestVariables(request: TesApiRequest, file: EnvironmentsFile): VarStatus[] {
  return requestVariableNames(request).map((name) => statusFor(name, file));
}
