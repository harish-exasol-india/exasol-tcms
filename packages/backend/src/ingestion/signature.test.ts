import { describe, expect, it } from 'vitest';
import { failureSignature, normalizeFailureText } from './signature.js';

const CASE = 'case-1';

describe('failure signature', () => {
  it('matches the same failure across runs despite run-specific noise', () => {
    const first =
      'AssertionError: expected 200 but got 503 at 2026-09-01T10:15:00Z after 1250ms (pid 4821)';
    const second =
      'AssertionError: expected 200 but got 503 at 2026-09-03T22:41:11Z after 980ms (pid 9134)';
    expect(failureSignature(CASE, first)).toBe(failureSignature(CASE, second));
  });

  it('normalises absolute paths to file names and line numbers to a marker', () => {
    const a = '/home/runner/work/repo/tests/e2e/test_sso.py:41:9: AssertionError';
    const b = '/var/lib/ci/checkout/tests/e2e/test_sso.py:88:3: AssertionError';
    expect(failureSignature(CASE, a)).toBe(failureSignature(CASE, b));
  });

  it('normalises uuids and memory addresses', () => {
    const a = 'Session 3f2b1c4d-1111-4a2b-9c8d-1234567890ab failed at 0xdeadbeef';
    const b = 'Session 99887766-2222-4a2b-9c8d-abcdefabcdef failed at 0xcafebabe';
    expect(failureSignature(CASE, a)).toBe(failureSignature(CASE, b));
  });

  it('does NOT conflate materially different failures', () => {
    const timeout = 'TimeoutError: waiting for selector ".grid-row" failed';
    const assertion = 'AssertionError: expected 200 but got 503';
    expect(failureSignature(CASE, timeout)).not.toBe(failureSignature(CASE, assertion));
  });

  it('scopes a signature to its case, so triage cannot leak between tests', () => {
    const message = 'ConnectionError: could not connect to backend';
    expect(failureSignature('case-a', message)).not.toBe(failureSignature('case-b', message));
  });

  it('gives an unspecified failure a stable signature rather than failing', () => {
    expect(failureSignature(CASE, null)).toBe(failureSignature(CASE, null));
    expect(failureSignature(CASE, null)).not.toBe(failureSignature(CASE, 'real message'));
  });

  it('is stable across whitespace and truncation differences', () => {
    expect(normalizeFailureText('  a   b \n c ')).toBe('a b c');
    expect(normalizeFailureText('x'.repeat(900))).toHaveLength(500);
  });

  it('is deterministic', () => {
    const message = 'AssertionError: values differ';
    const signatures = new Set(Array.from({ length: 20 }, () => failureSignature(CASE, message)));
    expect(signatures.size).toBe(1);
  });
});
