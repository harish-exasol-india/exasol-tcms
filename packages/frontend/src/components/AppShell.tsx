import type { CurrentUser } from '@tcms/shared';
import type { ReactNode } from 'react';
import { useSignOut } from '../lib/auth.js';

const TABS = [
  { id: 'cases', label: 'Test cases' },
  { id: 'runs', label: 'Runs' },
  { id: 'triage', label: 'Triage' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'releases', label: 'Releases' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'automation', label: 'Automation' },
  { id: 'projects', label: 'Projects' },
] as const;

type Tab =
  | 'cases'
  | 'runs'
  | 'triage'
  | 'coverage'
  | 'releases'
  | 'metrics'
  | 'automation'
  | 'projects';

export function AppShell({
  user,
  tab,
  onTab,
  projects,
  activeProjectId,
  onProject,
  children,
}: {
  user: CurrentUser;
  tab: Tab;
  onTab: (tab: Tab) => void;
  projects: CurrentUser['memberships'];
  activeProjectId: string | null;
  onProject: (id: string) => void;
  children: ReactNode;
}) {
  const signOut = useSignOut();
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Exasol TCMS</span>

        {projects.length > 1 ? (
          <select
            data-testid="project-switcher"
            value={activeProjectId ?? ''}
            onChange={(e) => onProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.projectName}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">{projects[0]?.projectName}</span>
        )}

        <nav>
          {TABS.map(({ id: t, label }) => (
            <button
              type="button"
              key={t}
              data-testid={`tab-${t}`}
              className={`tab${tab === t ? ' active' : ''}`}
              onClick={() => onTab(t)}
            >
              {label}
            </button>
          ))}
        </nav>

        <span style={{ flex: 1 }} />
        <span className="muted">{user.displayName}</span>
        <button
          type="button"
          className="secondary"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          Sign out
        </button>
      </header>
      <main>{children}</main>
    </div>
  );
}
