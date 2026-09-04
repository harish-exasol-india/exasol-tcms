import { normalizeTag, type TestCase } from '@tcms/shared';
import { useEffect, useState } from 'react';
import { useCaseHistory, useUpdateCase } from '../lib/repository.js';

/** Case detail and edit (task 4.11), with the change history alongside (task 4.12). */
export function CaseDetail({
  projectId,
  testCase,
  canEdit,
  onClose,
}: {
  projectId: string;
  testCase: TestCase;
  canEdit: boolean;
  onClose: () => void;
}) {
  const update = useUpdateCase(projectId, testCase.id);
  const history = useCaseHistory(projectId, testCase.id);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(testCase.title);
  const [priority, setPriority] = useState(testCase.priority);
  const [risk, setRisk] = useState(testCase.risk);
  const [preconditions, setPreconditions] = useState(testCase.preconditions ?? '');
  const [tagText, setTagText] = useState(testCase.tags.join(', '));

  // Reset the form whenever a different case is opened.
  useEffect(() => {
    setEditing(false);
    setTitle(testCase.title);
    setPriority(testCase.priority);
    setRisk(testCase.risk);
    setPreconditions(testCase.preconditions ?? '');
    setTagText(testCase.tags.join(', '));
  }, [testCase]);

  // Previewing the normalised form makes the write-time convergence visible while typing,
  // rather than surprising the author after saving (design Decision 2).
  const previewTags = tagText
    .split(',')
    .map((t) => normalizeTag(t))
    .filter((t): t is string => Boolean(t));

  function save() {
    update.mutate(
      {
        title,
        priority,
        risk,
        preconditions: preconditions.trim() === '' ? null : preconditions,
        tags: previewTags,
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <aside className="case-detail" data-testid="case-detail">
      <header>
        <span className="mono">{testCase.ref}</span>
        <span style={{ flex: 1 }} />
        {canEdit && !editing ? (
          <button
            type="button"
            className="secondary"
            data-testid="edit-case"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        ) : null}
        {editing ? (
          <>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="save-case"
              onClick={save}
              disabled={update.isPending}
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : null}
        <button type="button" className="secondary" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="case-detail-body">
        {editing ? (
          <div className="form">
            <label>
              Title
              <input
                data-testid="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ flex: 1 }}>
                Priority
                <select
                  data-testid="edit-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                >
                  {['low', 'medium', 'high', 'critical'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ flex: 1 }}>
                Risk
                <select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
                  {['low', 'medium', 'high'].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Preconditions
              <input value={preconditions} onChange={(e) => setPreconditions(e.target.value)} />
            </label>
            <label>
              Tags (comma separated)
              <input
                data-testid="edit-tags"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
              />
            </label>
            <div className="tags" data-testid="tag-preview">
              {previewTags.map((t) => (
                <span key={t} className="badge tag">
                  {t}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <>
            <h2 data-testid="case-title">{testCase.title}</h2>
            <dl className="meta">
              <dt>Suite</dt>
              <dd>{testCase.suitePath.join(' / ')}</dd>
              <dt>Owner</dt>
              <dd>{testCase.ownerName ?? <span className="muted">unassigned</span>}</dd>
              <dt>Priority</dt>
              <dd data-testid="case-priority">{testCase.priority}</dd>
              <dt>Risk</dt>
              <dd>{testCase.risk}</dd>
              <dt>Automation</dt>
              <dd>{testCase.isAutomated ? 'automated' : 'manual'}</dd>
              <dt>Tags</dt>
              <dd className="tags" data-testid="case-tags">
                {testCase.tags.length ? (
                  testCase.tags.map((t) => (
                    <span key={t} className="badge tag">
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="muted">none</span>
                )}
              </dd>
            </dl>

            {testCase.preconditions ? (
              <>
                <h3>Preconditions</h3>
                <p>{testCase.preconditions}</p>
              </>
            ) : null}

            <h3>Steps</h3>
            <ol className="steps">
              {testCase.steps.map((step) => (
                <li key={step.position}>
                  {step.sharedStepItems ? (
                    <div className="shared-step">
                      <span className="badge">shared: {step.sharedStepName}</span>
                      <ol>
                        {step.sharedStepItems.map((item) => (
                          <li key={item.position}>
                            <div>{item.action}</div>
                            {item.expected ? <div className="muted">→ {item.expected}</div> : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : (
                    <>
                      <div>{step.action}</div>
                      {step.expected ? <div className="muted">→ {step.expected}</div> : null}
                    </>
                  )}
                </li>
              ))}
            </ol>

            <h3>History</h3>
            <ul className="history" data-testid="case-history">
              {history.data?.entries.map((entry) => (
                <li key={entry.id}>
                  <span className="badge">{entry.action}</span>{' '}
                  <span>{entry.actorName ?? 'system'}</span>{' '}
                  <span className="badge origin">{entry.origin}</span>{' '}
                  <span className="muted">{new Date(entry.occurredAt).toLocaleString()}</span>
                  {entry.changedFields.length ? (
                    <div className="muted">changed: {entry.changedFields.join(', ')}</div>
                  ) : null}
                </li>
              ))}
              {history.isPending ? <li className="muted">loading…</li> : null}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
