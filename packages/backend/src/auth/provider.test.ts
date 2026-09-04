import { describe, expect, it } from 'vitest';
import { type AuthProvider, AuthProviderRegistry } from './provider.js';

const stub = (name: 'local' | 'oidc'): AuthProvider => ({
  name,
  authenticate: async () => null,
});

describe('auth provider registry', () => {
  it('resolves a registered provider by name', () => {
    const registry = new AuthProviderRegistry().register(stub('local'));
    expect(registry.get('local')?.name).toBe('local');
  });

  it('returns undefined for an unregistered provider', () => {
    expect(new AuthProviderRegistry().get('oidc')).toBeUndefined();
  });

  it('accepts an additional provider without altering the existing one', () => {
    const registry = new AuthProviderRegistry().register(stub('local'));
    registry.register(stub('oidc'));
    expect(registry.names.sort()).toEqual(['local', 'oidc']);
    expect(registry.get('local')?.name).toBe('local');
  });
});
