/**
 * API client.
 *
 * Responses are parsed through the shared Zod contracts rather than cast, so a backend
 * change that breaks the contract surfaces here instead of as an undefined deep in a view.
 */
import { type ErrorResponse, errorResponseSchema } from '@tcms/shared';
import type { z } from 'zod';

const BASE = import.meta.env['VITE_API_BASE'] ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorResponse,
  ) {
    super(body.error);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    // The session is an httpOnly cookie; it is never readable by this code.
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(await response.json().catch(() => ({})));
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data : { error: response.statusText },
    );
  }

  if (response.status === 204) return undefined as T;
  const json = await response.json();
  return schema ? schema.parse(json) : (json as T);
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>) => request(path, schema, { method: 'GET' }),
  post: <T>(path: string, schema: z.ZodType<T> | null, body?: unknown) =>
    request(path, schema, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  put: <T>(path: string, schema: z.ZodType<T> | null, body?: unknown) =>
    request(path, schema, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, schema: z.ZodType<T> | null, body?: unknown) =>
    request(path, schema, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string, schema: z.ZodType<T> | null) =>
    request(path, schema, { method: 'DELETE' }),
};
