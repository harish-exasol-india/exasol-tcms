import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('config', () => {
  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('applies defaults when only the required values are present', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://localhost/tcms' });
    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.NODE_ENV).toBe('development');
  });

  it('coerces PORT from its string environment form', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://x/y', PORT: '8080' });
    expect(config.PORT).toBe(8080);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x/y', LOG_LEVEL: 'chatty' })).toThrow();
  });
});
