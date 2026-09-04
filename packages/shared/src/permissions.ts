import { z } from 'zod';
import type { ProjectRole } from './roles.js';

/**
 * The complete permission vocabulary. Every guarded operation names one of these; nothing
 * is authorised by checking a role directly at a call site (design Decision 6).
 */
export const permissionSchema = z.enum([
  // repository
  'case.read',
  'case.create',
  'case.edit',
  'case.delete',
  'suite.manage',
  'shared_step.manage',
  'custom_field.manage',
  // planning
  'plan.manage',
  'environment.manage',
  'release.manage',
  'release.sign_off',
  // execution
  'run.read',
  'run.create',
  'run.execute',
  'run.close',
  'defect.link',
  'triage.update',
  // reporting
  'report.read',
  'export.perform',
  // administration
  'project.settings',
  'member.manage',
  'token.manage',
]);

export type Permission = z.infer<typeof permissionSchema>;

const ALL = permissionSchema.options;

const VIEWER: readonly Permission[] = ['case.read', 'run.read', 'report.read', 'export.perform'];

const TESTER: readonly Permission[] = [...VIEWER, 'run.execute', 'defect.link', 'triage.update'];

const LEAD: readonly Permission[] = [
  ...TESTER,
  'case.create',
  'case.edit',
  'case.delete',
  'suite.manage',
  'shared_step.manage',
  'plan.manage',
  'environment.manage',
  'release.manage',
  'release.sign_off',
  'run.create',
  'run.close',
];

/**
 * The role matrix. Data, not branching logic — which is what makes AC 9's complaint about
 * hardcoded admin permissions structurally impossible to reintroduce.
 */
export const ROLE_PERMISSIONS: Readonly<Record<ProjectRole, readonly Permission[]>> = {
  viewer: VIEWER,
  tester: TESTER,
  lead: LEAD,
  admin: ALL,
};

/** True when the role grants the permission. The only place a role is interpreted. */
export function roleGrants(role: ProjectRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
