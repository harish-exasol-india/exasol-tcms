import type { CurrentUser } from '@tcms/shared';
import { useMemo, useState } from 'react';
import { useCase, useCases, useSuites, useTags } from '../lib/repository.js';
import { CaseDetail } from './CaseDetail.js';
import { CaseList } from './CaseList.js';
import { SuiteTree } from './SuiteTree.js';

const EDITING_ROLES = new Set(['admin', 'lead']);

export function RepositoryView({
  projectId,
  role,
}: {
  projectId: string;
  role: CurrentUser['memberships'][number]['role'];
}) {
  const [suiteId, setSuiteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [automated, setAutomated] = useState<'true' | 'false' | ''>('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      ...(suiteId ? { suiteId } : {}),
      ...(search ? { search } : {}),
      ...(automated ? { automated } : {}),
      ...(activeTags.length ? { tags: activeTags } : {}),
    }),
    [suiteId, search, automated, activeTags],
  );

  const suites = useSuites(projectId);
  const tags = useTags(projectId);
  const cases = useCases(projectId, filters);
  const selected = useCase(projectId, selectedCaseId);

  const items = cases.data?.pages.flatMap((p) => p.items) ?? [];
  const total = cases.data?.pages[0]?.total ?? 0;

  const toggleTag = (name: string) =>
    setActiveTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );

  return (
    <div className="repository">
      <div className="repository-sidebar">
        {suites.data ? (
          <SuiteTree suites={suites.data.suites} selectedId={suiteId} onSelect={setSuiteId} />
        ) : (
          <p className="muted">Loading suites…</p>
        )}

        <div className="filter-block">
          <h3>Tags</h3>
          <div className="tags">
            {(tags.data?.tags ?? []).slice(0, 24).map((tag) => (
              <button
                type="button"
                key={tag.name}
                data-testid={`tag-filter-${tag.name}`}
                className={`badge tag${activeTags.includes(tag.name) ? ' active' : ''}`}
                onClick={() => toggleTag(tag.name)}
              >
                {tag.name} <span className="muted">{tag.usageCount}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="repository-main">
        <div className="toolbar">
          <input
            data-testid="case-search"
            placeholder="Search by title or reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            data-testid="automation-filter"
            value={automated}
            onChange={(e) => setAutomated(e.target.value as typeof automated)}
          >
            <option value="">All automation</option>
            <option value="true">Automated</option>
            <option value="false">Manual</option>
          </select>
          {activeTags.length ? (
            <button type="button" className="secondary" onClick={() => setActiveTags([])}>
              Clear {activeTags.length} tag filter{activeTags.length === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>

        {cases.isPending ? (
          <p className="muted">Loading cases…</p>
        ) : (
          <CaseList
            cases={items}
            total={total}
            selectedId={selectedCaseId}
            onSelect={setSelectedCaseId}
            onLoadMore={() => void cases.fetchNextPage()}
            hasMore={Boolean(cases.hasNextPage)}
            isLoadingMore={cases.isFetchingNextPage}
          />
        )}
      </div>

      {selected.data ? (
        <CaseDetail
          projectId={projectId}
          testCase={selected.data}
          canEdit={EDITING_ROLES.has(role)}
          onClose={() => setSelectedCaseId(null)}
        />
      ) : null}
    </div>
  );
}
