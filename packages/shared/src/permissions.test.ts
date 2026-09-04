import { describe, expect, it } from 'vitest';
import { permissionSchema, ROLE_PERMISSIONS, roleGrants } from './permissions.js';
import { projectRoleSchema } from './roles.js';

describe('role permission matrix', () => {
  it('defines a permission set for every role', () => {
    for (const role of projectRoleSchema.options) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it('grants an admin every permission', () => {
    for (const permission of permissionSchema.options) {
      expect(roleGrants('admin', permission)).toBe(true);
    }
  });

  it('grants a viewer no mutating permission', () => {
    expect(roleGrants('viewer', 'case.read')).toBe(true);
    expect(roleGrants('viewer', 'case.edit')).toBe(false);
    expect(roleGrants('viewer', 'run.execute')).toBe(false);
    expect(roleGrants('viewer', 'member.manage')).toBe(false);
  });

  it('lets a tester execute runs but not author cases', () => {
    expect(roleGrants('tester', 'run.execute')).toBe(true);
    expect(roleGrants('tester', 'defect.link')).toBe(true);
    expect(roleGrants('tester', 'case.create')).toBe(false);
    expect(roleGrants('tester', 'release.sign_off')).toBe(false);
  });

  it('lets a lead author and manage but not administer the project', () => {
    expect(roleGrants('lead', 'case.create')).toBe(true);
    expect(roleGrants('lead', 'release.sign_off')).toBe(true);
    expect(roleGrants('lead', 'member.manage')).toBe(false);
    expect(roleGrants('lead', 'project.settings')).toBe(false);
    expect(roleGrants('lead', 'token.manage')).toBe(false);
  });

  it('is strictly increasing: each role includes everything the weaker one has', () => {
    const chain = ['viewer', 'tester', 'lead', 'admin'] as const;
    for (let i = 1; i < chain.length; i++) {
      for (const permission of ROLE_PERMISSIONS[chain[i - 1]!]) {
        expect(roleGrants(chain[i]!, permission)).toBe(true);
      }
    }
  });

  it('leaves no permission ungranted by every role', () => {
    for (const permission of permissionSchema.options) {
      const granted = projectRoleSchema.options.some((r) => roleGrants(r, permission));
      expect(granted, `${permission} is granted to nobody`).toBe(true);
    }
  });
});
