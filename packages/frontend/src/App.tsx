import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from './components/AppShell.js';
import { BindingReport } from './components/BindingReport.js';
import { CoverageView } from './components/CoverageView.js';
import { MemberAdmin } from './components/MemberAdmin.js';
import { MetricsView } from './components/MetricsView.js';
import { ProjectList } from './components/ProjectList.js';
import { ReleaseView } from './components/ReleaseView.js';
import { RepositoryView } from './components/RepositoryView.js';
import { RunsView } from './components/RunsView.js';
import { SignIn } from './components/SignIn.js';
import { TriageView } from './components/TriageView.js';
import { useCurrentUser } from './lib/auth.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

type Tab =
  | 'cases'
  | 'runs'
  | 'triage'
  | 'coverage'
  | 'releases'
  | 'metrics'
  | 'automation'
  | 'projects';

function Authenticated() {
  const { data: user, isPending, isError } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('cases');
  const [projectId, setProjectId] = useState<string | null>(null);

  if (isPending) return <div className="centered muted">Loading…</div>;
  if (isError) return <div className="centered error">Could not reach the server.</div>;
  if (!user) return <SignIn />;

  const activeProjectId = projectId ?? user.memberships[0]?.projectId ?? null;
  const membership = user.memberships.find((m) => m.projectId === activeProjectId);

  return (
    <AppShell
      user={user}
      tab={tab}
      onTab={setTab}
      projects={user.memberships}
      activeProjectId={activeProjectId}
      onProject={setProjectId}
    >
      {tab === 'cases' && membership ? (
        <RepositoryView projectId={membership.projectId} role={membership.role} />
      ) : null}
      {tab === 'cases' && !membership ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            You are not a member of any project yet.
          </p>
        </div>
      ) : null}
      {tab === 'runs' && membership ? (
        <RunsView
          projectId={membership.projectId}
          canManage={membership.role === 'admin' || membership.role === 'lead'}
        />
      ) : null}
      {tab === 'triage' && membership ? (
        <TriageView projectId={membership.projectId} canTriage={membership.role !== 'viewer'} />
      ) : null}
      {tab === 'releases' && membership ? (
        <ReleaseView
          projectId={membership.projectId}
          canSignOff={membership.role === 'admin' || membership.role === 'lead'}
          canManage={membership.role === 'admin' || membership.role === 'lead'}
        />
      ) : null}
      {tab === 'metrics' && membership ? <MetricsView projectId={membership.projectId} /> : null}
      {tab === 'coverage' && membership ? <CoverageView projectId={membership.projectId} /> : null}
      {tab === 'automation' && membership ? (
        <div style={{ padding: '16px' }}>
          <BindingReport projectId={membership.projectId} />
        </div>
      ) : null}
      {tab === 'projects' ? (
        <div style={{ padding: '16px' }}>
          <ProjectList user={user} activeProjectId={activeProjectId} onSelect={setProjectId} />
          {membership ? (
            <MemberAdmin projectId={membership.projectId} canManage={membership.role === 'admin'} />
          ) : null}
        </div>
      ) : null}
    </AppShell>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Authenticated />
    </QueryClientProvider>
  );
}
