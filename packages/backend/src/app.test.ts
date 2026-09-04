import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

describe('app', () => {
  it('serves liveness without touching any dependency', async () => {
    const app = await buildApp(loadConfig({ DATABASE_URL: 'postgres://unreachable/nowhere' }));
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
