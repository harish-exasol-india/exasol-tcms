import type { Outcome, RunCase } from '@tcms/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api.js';
import {
  attachmentUrl,
  useLinkDefect,
  useRecordResult,
  useRun,
  useRunCase,
  useUploadAttachment,
} from '../lib/execution.js';

const OUTCOMES: { value: Outcome; label: string; key: string }[] = [
  { value: 'passed', label: 'Pass', key: '1' },
  { value: 'failed', label: 'Fail', key: '2' },
  { value: 'blocked', label: 'Block', key: '3' },
  { value: 'skipped', label: 'Skip', key: '4' },
];

type Conflict = { outcome: string; version: number; updatedBy: string | null; updatedAt: string };

/**
 * Manual run execution (tasks 9.8, 9.9).
 *
 * Optimised for repeated keyboard-driven execution: 1-4 record an outcome and advance, so a
 * tester can work a run without reaching for the mouse. A rejected write shows the other
 * tester's result before offering to overwrite it — never silently (design Decision 13).
 */
export function RunExecution({
  projectId,
  runId,
  onBack,
}: {
  projectId: string;
  runId: string;
  onBack: () => void;
}) {
  const run = useRun(projectId, runId);
  const [index, setIndex] = useState(0);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<Outcome | null>(null);
  const [issueKey, setIssueKey] = useState('');

  const cases = run.data?.cases ?? [];
  const current = cases[index];
  const detail = useRunCase(projectId, runId, current?.id ?? null);
  const record = useRecordResult(projectId, runId);
  const linkDefect = useLinkDefect(projectId, runId);
  const upload = useUploadAttachment(projectId, runId);

  // Resume where the tester left off: the first case without a result (task 9.2).
  useEffect(() => {
    if (cases.length === 0) return;
    const firstUntested = cases.findIndex((c) => c.outcome === 'untested');
    setIndex(firstUntested === -1 ? 0 : firstUntested);
  }, [cases.length, cases.findIndex]);

  const submit = useCallback(
    (outcome: Outcome, force = false) => {
      if (!current) return;
      const version = force ? (conflict?.version ?? current.version) : current.version;
      setPendingOutcome(outcome);
      record.mutate(
        { runCaseId: current.id, outcome, basedOnVersion: version },
        {
          onSuccess: () => {
            setConflict(null);
            setPendingOutcome(null);
            setIndex((i) => Math.min(i + 1, cases.length - 1));
          },
          onError: (error) => {
            if (error instanceof ApiError && error.status === 409) {
              const body = error.body as unknown as { current?: Conflict };
              setConflict(body.current ?? null);
            }
            setPendingOutcome(null);
          },
        },
      );
    },
    [current, conflict, cases.length, record],
  );

  // The keydown listener is registered once; this ref keeps it calling the current
  // implementation rather than a copy captured on first render.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Keyboard-driven execution.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;
      if (conflict) return;
      const match = OUTCOMES.find((o) => o.key === event.key);
      if (match) {
        event.preventDefault();
        submitRef.current(match.value);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'j')
        setIndex((i) => Math.min(i + 1, cases.length - 1));
      if (event.key === 'ArrowUp' || event.key === 'k') setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conflict, cases.length]);

  if (run.isPending) return <p className="muted">Loading run…</p>;
  if (!run.data) return <p className="error">Run not found.</p>;

  const progress = run.data.progress;
  const done = progress.total - progress.untested;

  return (
    <div className="repository">
      <div className="repository-sidebar" data-testid="run-case-list">
        <div style={{ padding: '8px 10px' }}>
          <button type="button" className="secondary" onClick={onBack}>
            ← Runs
          </button>
          <h3 style={{ margin: '10px 0 4px', fontSize: 14 }}>{run.data.name}</h3>
          <div className="coverage-bar" title={`${done} of ${progress.total} executed`}>
            {progress.passed > 0 ? (
              <span
                className="seg-automated"
                style={{ width: `${(progress.passed / progress.total) * 100}%` }}
              />
            ) : null}
            {progress.failed > 0 ? (
              <span
                className="seg-never"
                style={{ width: `${(progress.failed / progress.total) * 100}%` }}
              />
            ) : null}
            {progress.blocked + progress.skipped > 0 ? (
              <span
                className="seg-manual"
                style={{
                  width: `${((progress.blocked + progress.skipped) / progress.total) * 100}%`,
                }}
              />
            ) : null}
          </div>
          <p
            className="muted"
            data-testid="run-progress"
            style={{ fontSize: 12, margin: '6px 0 0' }}
          >
            {done}/{progress.total} executed · {progress.passed} passed · {progress.failed} failed
          </p>
        </div>
        <nav className="suite-tree">
          {cases.map((c, i) => (
            <div key={c.id} className={`suite-row${i === index ? ' selected' : ''}`}>
              <button
                type="button"
                className="suite-name"
                data-testid={`run-case-${c.ref}`}
                onClick={() => setIndex(i)}
              >
                <span className="mono">{c.ref}</span> {c.title}
              </button>
              <span className={`badge outcome-${c.outcome}`}>{c.outcome}</span>
            </div>
          ))}
        </nav>
      </div>

      <div className="repository-main" style={{ overflowY: 'auto', padding: 16 }}>
        {conflict ? (
          <div className="card conflict" data-testid="conflict-prompt">
            <h3 style={{ marginTop: 0 }}>Someone else recorded a result first</h3>
            <p>
              {conflict.updatedBy ?? 'Another tester'} recorded{' '}
              <strong data-testid="conflict-outcome">{conflict.outcome}</strong> at{' '}
              {new Date(conflict.updatedAt).toLocaleTimeString()}. Your result was not saved.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                data-testid="conflict-overwrite"
                onClick={() => pendingOutcome && submit(pendingOutcome, true)}
              >
                Overwrite with {pendingOutcome}
              </button>
              <button
                type="button"
                className="secondary"
                data-testid="conflict-keep"
                onClick={() => {
                  setConflict(null);
                  setPendingOutcome(null);
                  // Both queries must refresh: the list drives the version used for the next
                  // write, and the detail drives what the tester is looking at. Refreshing
                  // only the list leaves the panel showing the result that was just rejected.
                  void run.refetch();
                  void detail.refetch();
                }}
              >
                Keep theirs
              </button>
            </div>
          </div>
        ) : null}

        {current && detail.data ? (
          <ExecutionPanel
            runCase={detail.data}
            disabled={record.isPending || Boolean(conflict)}
            onRecord={submit}
            issueKey={issueKey}
            onIssueKey={setIssueKey}
            onLinkDefect={() => {
              linkDefect.mutate(
                { runCaseId: current.id, issueKey },
                { onSuccess: () => setIssueKey('') },
              );
            }}
            defectError={linkDefect.error instanceof ApiError ? linkDefect.error.body.error : null}
            projectId={projectId}
            onUpload={(file) => upload.mutate({ runCaseId: current.id, file })}
            uploading={upload.isPending}
            uploadError={upload.error instanceof ApiError ? upload.error.body.error : null}
          />
        ) : (
          <p className="muted">Select a case.</p>
        )}
      </div>
    </div>
  );
}

function ExecutionPanel({
  runCase,
  disabled,
  onRecord,
  issueKey,
  onIssueKey,
  onLinkDefect,
  defectError,
  projectId,
  onUpload,
  uploading,
  uploadError,
}: {
  runCase: RunCase;
  disabled: boolean;
  onRecord: (outcome: Outcome) => void;
  issueKey: string;
  onIssueKey: (value: string) => void;
  onLinkDefect: () => void;
  defectError: string | null;
  projectId: string;
  onUpload: (file: File) => void;
  uploading: boolean;
  uploadError: string | null;
}) {
  return (
    <div data-testid="execution-panel">
      <h2 style={{ marginTop: 0, fontSize: 17 }}>
        <span className="mono muted">{runCase.ref}</span> {runCase.title}
      </h2>
      <p className="muted">
        {runCase.suiteName} · priority {runCase.priority} · currently{' '}
        <span data-testid="current-outcome">{runCase.outcome}</span>
      </p>

      <div className="outcome-buttons">
        {OUTCOMES.map((o) => (
          <button
            type="button"
            key={o.value}
            data-testid={`record-${o.value}`}
            className={o.value === 'passed' ? '' : 'secondary'}
            disabled={disabled}
            onClick={() => onRecord(o.value)}
          >
            {o.label} <kbd>{o.key}</kbd>
          </button>
        ))}
      </div>

      <h3>Steps</h3>
      <ol className="steps">
        {runCase.steps.map((step) => (
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
            {step.outcome ? (
              <span className={`badge outcome-${step.outcome}`}>{step.outcome}</span>
            ) : null}
          </li>
        ))}
      </ol>

      <h3>Evidence</h3>
      {runCase.attachments.length > 0 ? (
        <ul className="history" data-testid="attachment-list">
          {runCase.attachments.map((a) => (
            <li key={a.id}>
              <a href={attachmentUrl(projectId, a.id)} target="_blank" rel="noreferrer">
                {a.filename}
              </a>{' '}
              <span className="muted">
                {(a.sizeBytes / 1024).toFixed(1)} KB
                {a.stepPosition ? ` · step ${a.stepPosition}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No evidence attached.</p>
      )}
      <input
        type="file"
        data-testid="attachment-input"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = '';
        }}
      />
      {uploadError ? (
        <p className="error" data-testid="attachment-error">
          {uploadError}
        </p>
      ) : null}

      <h3>Defects</h3>
      {runCase.defects.length > 0 ? (
        <ul className="history" data-testid="defect-list">
          {runCase.defects.map((d) => (
            <li key={d.id}>
              <span className="mono">{d.issueKey}</span>{' '}
              <span className="muted">linked {new Date(d.linkedAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None linked.</p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          data-testid="issue-key"
          placeholder="EXA-1234"
          value={issueKey}
          onChange={(e) => onIssueKey(e.target.value)}
        />
        <button type="button" data-testid="link-defect" disabled={!issueKey} onClick={onLinkDefect}>
          Link defect
        </button>
      </div>
      {defectError ? (
        <p className="error" data-testid="defect-error">
          {defectError}
        </p>
      ) : null}
    </div>
  );
}
