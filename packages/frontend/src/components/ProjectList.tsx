import type { CurrentUser } from '@tcms/shared';

export function ProjectList({
  user,
  activeProjectId,
  onSelect,
}: {
  user: CurrentUser;
  activeProjectId: string | null;
  onSelect: (id: string) => void;
}) {
  if (user.memberships.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          You are not a member of any project yet. An administrator must grant you a role.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Project</th>
            <th>Your role</th>
          </tr>
        </thead>
        <tbody>
          {user.memberships.map((m) => (
            <tr
              key={m.projectId}
              onClick={() => onSelect(m.projectId)}
              style={{
                cursor: 'pointer',
                background:
                  m.projectId === activeProjectId
                    ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                    : undefined,
              }}
            >
              <td>
                <code>{m.projectKey}</code>
              </td>
              <td>{m.projectName}</td>
              <td>
                <span className="badge">{m.role}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
