/**
 * Parser tests against JUnit XML produced by real Pytest and Playwright runs, not by hand.
 * The fixtures in __fixtures__ were emitted by `pytest --junitxml` and Playwright's junit
 * reporter respectively, so dialect differences are tested as they actually occur.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JUnitParseError, parseJUnitXml } from './junit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.join(here, '__fixtures__', `${name}.xml`), 'utf8');

describe('JUnit XML parser', () => {
  describe('real pytest output', () => {
    const report = parseJUnitXml(fixture('pytest'));

    it('reads every test in the report', () => {
      expect(report.tests).toHaveLength(7);
      expect(report.counts).toEqual({ passed: 4, failed: 2, skipped: 1 });
    });

    it('builds a fully-qualified name from classname and test name', () => {
      const names = report.tests.map((t) => t.fqName);
      expect(names).toContain('tests.test_sample::test_passes');
      // Pytest puts a test class into the classname, so nesting is preserved.
      expect(names).toContain('tests.test_sample.TestGroup::test_in_class');
    });

    it('captures a failure message and its detail', () => {
      const failed = report.tests.find((t) => t.name === 'test_fails');
      expect(failed?.outcome).toBe('failed');
      expect(failed?.failureMessage).toContain('values differ');
      expect(failed?.failureDetail).toContain('AssertionError');
    });

    it('treats a collection error as a failure, not a separate outcome', () => {
      // pytest emits <error> for an exception raised outside an assertion.
      const errored = report.tests.find((t) => t.name === 'test_errors');
      expect(errored?.outcome).toBe('failed');
      expect(errored?.failureMessage).toContain('RuntimeError');
    });

    it('recognises a skip expressed as a child element, not an attribute', () => {
      const skipped = report.tests.find((t) => t.name === 'test_skipped');
      expect(skipped?.outcome).toBe('skipped');
      expect(skipped?.failureMessage).toBeNull();
    });

    it('keeps parametrised variants as distinct tests', () => {
      const parametrized = report.tests.filter((t) => t.name.startsWith('test_parametrized'));
      expect(parametrized).toHaveLength(2);
      expect(new Set(parametrized.map((t) => t.fqName)).size).toBe(2);
    });

    it('converts seconds to milliseconds', () => {
      for (const test of report.tests) {
        expect(test.durationMs === null || Number.isInteger(test.durationMs)).toBe(true);
      }
    });
  });

  describe('real playwright output', () => {
    const report = parseJUnitXml(fixture('playwright'));

    it('handles the testsuites wrapper and file-based classnames', () => {
      expect(report.tests.length).toBeGreaterThanOrEqual(3);
      expect(report.tests.every((t) => t.classname.endsWith('.spec.ts'))).toBe(true);
      expect(report.tests.map((t) => t.fqName)).toContain('sample.spec.ts::passes');
    });

    it('reads outcomes across the report', () => {
      expect(report.counts.failed).toBeGreaterThanOrEqual(1);
      expect(report.counts.passed).toBeGreaterThanOrEqual(1);
    });

    it('captures the failure message from a CDATA body', () => {
      const failed = report.tests.find((t) => t.outcome === 'failed');
      expect(failed?.failureMessage).toContain('toBe');
      expect(failed?.failureDetail).toContain('Expected');
    });

    it('collapses a retried test into one entry -- the AC 7 gap, demonstrated', () => {
      // Playwright retried the failing test, but JUnit XML has no way to express that:
      // the retry appears only as an attachment path in system-out. This is why in-run
      // flakiness detection is recorded as an accepted gap (design Decision 8).
      const failing = report.tests.filter((t) => t.name === 'fails');
      expect(failing).toHaveLength(1);
    });
  });

  describe('case identifier extraction', () => {
    const report = parseJUnitXml(fixture('annotated'));

    it('reads a declared case reference from a property', () => {
      expect(report.tests[0]?.declaredCaseRef).toBe('EXA-1000');
    });

    it('reads a case reference from a marker in the test name', () => {
      expect(report.tests[1]?.declaredCaseRef).toBe('EXA-1001');
    });

    it('returns null when no reference is declared', () => {
      const pytest = parseJUnitXml(fixture('pytest'));
      expect(pytest.tests.every((t) => t.declaredCaseRef === null)).toBe(true);
    });
  });

  describe('malformed input is rejected atomically', () => {
    it('rejects a truncated document', () => {
      const truncated = fixture('pytest').slice(0, 400);
      expect(() => parseJUnitXml(truncated)).toThrow(JUnitParseError);
    });

    it('rejects an empty report', () => {
      expect(() => parseJUnitXml('')).toThrow(/empty/i);
      expect(() => parseJUnitXml('   ')).toThrow(/empty/i);
    });

    it('rejects XML that is not a JUnit report', () => {
      expect(() => parseJUnitXml('<html><body>not a report</body></html>')).toThrow(
        /no <testsuite>/,
      );
    });

    it('rejects a testcase with no name', () => {
      expect(() =>
        parseJUnitXml('<testsuite name="s"><testcase classname="c" time="1"/></testsuite>'),
      ).toThrow(/missing its name/);
    });

    it('reports the line of a syntax error', () => {
      expect(() => parseJUnitXml('<testsuite>\n<testcase>\n</testsuite>')).toThrow(/line \d+/);
    });

    it('accepts a bare testsuite root without the testsuites wrapper', () => {
      const report = parseJUnitXml(
        '<testsuite name="s"><testcase classname="c" name="t" time="0.5"/></testsuite>',
      );
      expect(report.tests).toHaveLength(1);
      expect(report.tests[0]?.durationMs).toBe(500);
    });

    it('handles a single testcase identically to several', () => {
      const one = parseJUnitXml(
        '<testsuite name="s"><testcase classname="c" name="a"/></testsuite>',
      );
      expect(one.tests).toHaveLength(1);
      expect(one.counts.passed).toBe(1);
    });
  });
});
