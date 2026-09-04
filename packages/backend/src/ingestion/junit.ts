/**
 * JUnit XML parser (design Decision 8).
 *
 * JUnit XML is the common denominator both Pytest (`--junitxml`) and Playwright (the junit
 * reporter) emit, so one parser covers AC 2's named frameworks. The dialects differ in
 * small ways this parser normalises:
 *
 *   - Pytest nests `<testcase>` under a single `<testsuite>`; Playwright wraps suites in
 *     `<testsuites>`. Both shapes are accepted.
 *   - Pytest puts the module path in `classname`; Playwright puts the file there.
 *   - A skipped test is an empty `<skipped/>` child, not an attribute.
 *   - `<error>` (a collection/setup failure) is distinct from `<failure>` (an assertion),
 *     but both are failures for reporting purposes.
 *
 * What JUnit XML cannot express is recorded in the design as accepted gaps: it carries no
 * attachments (AC 5) and no retry information (AC 7).
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type ParsedOutcome = 'passed' | 'failed' | 'skipped';

export type ParsedTest = {
  /** Fully-qualified name used for name-based binding: `classname::name`. */
  fqName: string;
  name: string;
  classname: string;
  suiteName: string;
  outcome: ParsedOutcome;
  durationMs: number | null;
  failureMessage: string | null;
  failureDetail: string | null;
  /** Case identifier declared by the test, when the property convention is used. */
  declaredCaseRef: string | null;
};

export type ParsedReport = {
  tests: ParsedTest[];
  counts: Record<ParsedOutcome, number>;
};

export class JUnitParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JUnitParseError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // A single child must still arrive as an array, otherwise a one-test report parses
  // differently from a two-test one.
  isArray: (name) =>
    ['testsuite', 'testcase', 'property', 'failure', 'error', 'skipped'].includes(name),
  parseAttributeValue: false,
  trimValues: true,
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const text = (node: unknown): string | null => {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return node.length ? node : null;
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const value = record['#text'];
    return typeof value === 'string' && value.length ? value : null;
  }
  return null;
};

/** `@tcms.id` / `tcms_id` property, or a `[EXA-1234]` marker in the test name. */
function extractCaseRef(testcase: Record<string, unknown>, name: string): string | null {
  const properties = asArray(
    (testcase['properties'] as Record<string, unknown> | undefined)?.['property'] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  for (const property of properties) {
    const key = String(property['@name'] ?? '').toLowerCase();
    if (key === 'tcms.id' || key === 'tcms_id' || key === 'test_case_id') {
      const value = String(property['@value'] ?? '').trim();
      if (value) return value;
    }
  }
  const marker = /\[([A-Z][A-Z0-9]*-\d+)\]/.exec(name);
  return marker?.[1] ?? null;
}

function parseDuration(raw: unknown): number | null {
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

export function parseJUnitXml(xml: string): ParsedReport {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    throw new JUnitParseError('Report is empty');
  }

  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (validation !== true) {
    throw new JUnitParseError(
      `Report is not well-formed XML: ${validation.err.msg} (line ${validation.err.line})`,
    );
  }

  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml) as Record<string, unknown>;
  } catch (error) {
    throw new JUnitParseError(
      `Report could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  // Either <testsuites><testsuite/></testsuites> or a bare <testsuite/> root.
  const root = document['testsuites'] as Record<string, unknown> | undefined;
  const suites = root
    ? asArray(root['testsuite'] as Record<string, unknown>[] | undefined)
    : asArray(document['testsuite'] as Record<string, unknown>[] | undefined);

  if (suites.length === 0) {
    throw new JUnitParseError('Report contains no <testsuite> element');
  }

  const tests: ParsedTest[] = [];
  for (const suite of suites) {
    const suiteName = String(suite['@name'] ?? 'unnamed suite');
    for (const testcase of asArray(suite['testcase'] as Record<string, unknown>[] | undefined)) {
      const name = String(testcase['@name'] ?? '').trim();
      if (!name) throw new JUnitParseError('A <testcase> is missing its name attribute');
      const classname = String(testcase['@classname'] ?? testcase['@file'] ?? suiteName).trim();

      const failures = asArray(testcase['failure'] as Record<string, unknown>[] | undefined);
      const errors = asArray(testcase['error'] as Record<string, unknown>[] | undefined);
      const skipped = asArray(testcase['skipped'] as Record<string, unknown>[] | undefined);
      const problem = failures[0] ?? errors[0];

      const outcome: ParsedOutcome = problem ? 'failed' : skipped.length > 0 ? 'skipped' : 'passed';

      tests.push({
        fqName: `${classname}::${name}`,
        name,
        classname,
        suiteName,
        outcome,
        durationMs: parseDuration(testcase['@time']),
        failureMessage: problem ? String(problem['@message'] ?? 'Test failed') : null,
        failureDetail: problem ? text(problem) : null,
        declaredCaseRef: extractCaseRef(testcase, name),
      });
    }
  }

  const counts: Record<ParsedOutcome, number> = { passed: 0, failed: 0, skipped: 0 };
  for (const test of tests) counts[test.outcome] += 1;

  return { tests, counts };
}
