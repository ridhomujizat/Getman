import { invoke } from '@tauri-apps/api/core';
import type { TesApiRequest, TesApiResponse, HttpError } from '../types';

export async function sendRequest(req: TesApiRequest): Promise<TesApiResponse> {
  // Rust returns HttpError as the rejected value; rethrow shaped.
  return invoke<TesApiResponse>('send_request', { req });
}

export function isHttpError(e: unknown): e is HttpError {
  return !!e && typeof e === 'object' && 'kind' in e && 'message' in e;
}

export function friendlyError(e: unknown): string {
  if (isHttpError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
