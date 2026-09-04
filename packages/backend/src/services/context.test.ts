import { describe, expect, it } from 'vitest';
import type { Principal } from '../auth/authorization.js';
import { actorIdOf, contextFor, originOf, tokenIdOf } from './context.js';

const asUser = (origin: 'ui' | 'api' | 'mcp'): Principal => ({
  kind: 'user',
  userId: 'user-1',
  origin,
});

describe('request context attribution', () => {
  it('distinguishes the three interfaces a write can arrive through', () => {
    expect(originOf(contextFor(asUser('ui')))).toBe('ui');
    expect(originOf(contextFor(asUser('api')))).toBe('api');
    expect(originOf(contextFor(asUser('mcp')))).toBe('mcp');
  });

  it('carries the acting user for a human write', () => {
    const ctx = contextFor(asUser('mcp'));
    expect(actorIdOf(ctx)).toBe('user-1');
    expect(tokenIdOf(ctx)).toBeNull();
  });

  it('records the token and no human actor for a machine write', () => {
    const ctx = contextFor({
      kind: 'token',
      tokenId: 'tok-9',
      projectId: 'proj-1',
      scopes: ['results:write'],
      origin: 'api',
    });
    expect(actorIdOf(ctx)).toBeNull();
    expect(tokenIdOf(ctx)).toBe('tok-9');
    expect(originOf(ctx)).toBe('api');
  });

  it('an agent write is attributable to the human whose token was used', () => {
    // MCP acts as a user, so an agent-authored case names both the interface and the person.
    const ctx = contextFor(asUser('mcp'));
    expect(originOf(ctx)).toBe('mcp');
    expect(actorIdOf(ctx)).toBe('user-1');
  });
});
