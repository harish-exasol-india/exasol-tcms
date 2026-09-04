import { describe, expect, it } from 'vitest';
import { originSchema, projectRoleSchema } from './roles.js';

describe('shared role contract', () => {
  it('accepts every defined project role', () => {
    for (const role of projectRoleSchema.options) {
      expect(projectRoleSchema.parse(role)).toBe(role);
    }
  });

  it('rejects a role outside the fixed set', () => {
    expect(() => projectRoleSchema.parse('wizard')).toThrow();
  });

  it('defines exactly the four roles the design specifies', () => {
    expect([...projectRoleSchema.options].sort()).toEqual(['admin', 'lead', 'tester', 'viewer']);
  });

  it('records write origin as one of ui, api, or mcp', () => {
    expect([...originSchema.options].sort()).toEqual(['api', 'mcp', 'ui']);
  });
});
