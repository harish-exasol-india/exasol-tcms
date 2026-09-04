/**
 * Failure signature derivation (design Decision 15).
 *
 * A signature identifies "the same failure happening again", which is what lets a human's
 * triage decision carry forward automatically instead of every import re-triaging known
 * failures from zero (AC 6).
 *
 * The normalisation rule is the tuning knob the design records as an open question: too
 * coarse and genuinely new breaks hide inside an existing group; too fine and
 * carry-forward never matches. Everything stripped here is run-specific noise that would
 * otherwise make every occurrence look unique.
 */
import { createHash } from 'node:crypto';

const NOISE_PATTERNS: [RegExp, string][] = [
  // Timestamps and durations
  [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<timestamp>'],
  [/\b\d+(?:\.\d+)?\s?(?:ms|s|seconds|minutes)\b/gi, '<duration>'],
  // Memory addresses and object ids
  [/0x[0-9a-f]{4,}/gi, '<address>'],
  // UUIDs and long hex ids
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b[0-9a-f]{32,}\b/gi, '<hash>'],
  // Absolute paths, keeping the file name
  [/(?:\/[\w.-]+)+\/([\w.-]+\.(?:py|ts|js|tsx|java))/g, '$1'],
  // Line and column markers
  [/:\d+:\d+\b/g, ':<line>'],
  [/\bline \d+\b/gi, 'line <line>'],
  // Ports and process ids
  [/\b(?:port|pid)[ =:]\s*\d+/gi, '<pid>'],
  // Bare long numbers
  [/\b\d{4,}\b/g, '<number>'],
];

/** Reduces a failure message to its stable shape. Exported for testing the rule directly. */
export function normalizeFailureText(raw: string): string {
  let text = raw.trim();
  for (const [pattern, replacement] of NOISE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, ' ').slice(0, 500);
}

/**
 * A signature is scoped to the bound case: the same message failing in two different tests
 * is two different problems, and conflating them would carry one team's triage onto
 * another's failure.
 */
export function failureSignature(caseId: string, failureMessage: string | null): string {
  const normalized = normalizeFailureText(failureMessage ?? 'unspecified failure');
  return createHash('sha256').update(`${caseId} ${normalized}`).digest('hex').slice(0, 32);
}
