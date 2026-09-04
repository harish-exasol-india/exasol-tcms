import { type ProjectRole, projectRoleSchema } from '@tcms/shared';
import { useState } from 'react';
import { ApiError } from '../lib/api.js';
import { useAssignableUsers, useAssignRole, useMembers, useRevokeRole } from '../lib/members.js';

/**
 * Membership administration (task 3.10). Rendered only for administrators; the backend
 * enforces the same rule independently, so hiding the UI is convenience, not security.
 */
export function MemberAdmin({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const members = useMembers(projectId);
  const assignable = useAssignableUsers(projectId, canManage);
  const assign = useAssignRole(projectId);
  const revoke = useRevokeRole(projectId);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectRole>('tester');

  const error = revoke.error ?? assign.error;
  const message =
    error instanceof ApiError ? error.body.error : error ? 'Something went wrong.' : null;

  const memberIds = new Set(members.data?.members.map((m) => m.userId) ?? []);
  const candidates = (assignable.data?.users ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="member-admin">
      <h2 style={{ marginTop: 0, fontSize: 15 }}>Members</h2>

      {members.isPending ? <p className="muted">Loading members…</p> : null}
      {members.data ? (
        <table data-testid="members-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              {canManage ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {members.data.members.map((m) => (
              <tr key={m.userId}>
                <td>{m.displayName}</td>
                <td className="muted">{m.email}</td>
                <td>
                  {canManage ? (
                    <select
                      data-testid={`role-${m.userId}`}
                      value={m.role}
                      onChange={(e) =>
                        assign.mutate({ userId: m.userId, role: e.target.value as ProjectRole })
                      }
                    >
                      {projectRoleSchema.options.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge">{m.role}</span>
                  )}
                </td>
                {canManage ? (
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="secondary"
                      data-testid={`revoke-${m.userId}`}
                      onClick={() => revoke.mutate(m.userId)}
                      disabled={revoke.isPending}
                    >
                      Revoke
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {message ? (
        <p className="error" data-testid="member-error" style={{ marginBottom: 0 }}>
          {message}
        </p>
      ) : null}

      {canManage ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 14 }}>
          <label style={{ flex: 1 }}>
            Add member
            <select
              data-testid="add-member-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <label>
            Role
            <select
              data-testid="add-member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectRole)}
            >
              {projectRoleSchema.options.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="grant"
            disabled={!userId || assign.isPending}
            onClick={() => {
              assign.mutate({ userId, role });
              setUserId('');
            }}
          >
            Grant
          </button>
        </div>
      ) : null}
    </div>
  );
}
