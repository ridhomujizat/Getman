import type { TesApiRequest, KeyValue } from '../types';

export function substitute(value: string, variables: Record<string, string>, unresolved: Set<string>): string {
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => {
    const name = key.trim();
    if (!(name in variables)) {
      unresolved.add(name);
      return match;
    }
    return variables[name];
  });
}

function rows(items: KeyValue[] | undefined, variables: Record<string, string>, unresolved: Set<string>): KeyValue[] | undefined {
  return items?.map((item) => ({
    ...item,
    key: substitute(item.key, variables, unresolved),
    value: substitute(item.value, variables, unresolved),
    description: item.description ? substitute(item.description, variables, unresolved) : item.description,
  }));
}

export function resolveRequest(request: TesApiRequest, environment: KeyValue[]): { request: TesApiRequest; unresolved: string[] } {
  const variables = Object.fromEntries(environment.filter((item) => item.enabled && item.key).map((item) => [item.key, item.value]));
  const unresolved = new Set<string>();
  const resolved: TesApiRequest = {
      ...request,
      url: substitute(request.url, variables, unresolved),
      params: rows(request.params, variables, unresolved) ?? [],
      headers: rows(request.headers, variables, unresolved) ?? [],
      body: { ...request.body, raw: substitute(request.body.raw ?? '', variables, unresolved), formData: rows(request.body.formData, variables, unresolved) },
      auth: {
        ...request.auth,
        token: request.auth.token ? substitute(request.auth.token, variables, unresolved) : request.auth.token,
        username: request.auth.username ? substitute(request.auth.username, variables, unresolved) : request.auth.username,
        password: request.auth.password ? substitute(request.auth.password, variables, unresolved) : request.auth.password,
        key: request.auth.key ? substitute(request.auth.key, variables, unresolved) : request.auth.key,
        value: request.auth.value ? substitute(request.auth.value, variables, unresolved) : request.auth.value,
      },
    };
  return { request: resolved, unresolved: [...unresolved] };
}
