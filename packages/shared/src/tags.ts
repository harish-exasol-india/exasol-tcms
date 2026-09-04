/**
 * Tag normalisation (design Decision 2).
 *
 * Tags are free-form, which is what makes them cheap and also what makes them rot. Coverage
 * reporting groups by tag, so `e2e` / `E2E` / `End-To-End` splitting into three tags would
 * quietly make AC 3's numbers wrong. Normalising on write is the mitigation: it converges
 * the common variants without requiring an admin-managed vocabulary.
 *
 * Shared between frontend and backend so the value previewed while typing is exactly the
 * value stored.
 */

/**
 * Lowercases, trims, collapses internal whitespace, and folds separator runs.
 * Returns null when nothing usable remains.
 */
export function normalizeTag(raw: string): string | null {
  const normalized = raw
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    // Whitespace and underscores become hyphens, so "end to end" and "end_to_end"
    // converge on "end-to-end".
    .replace(/[\s_]+/g, '-')
    // Collapse repeated separators: "e2e--web" -> "e2e-web".
    .replace(/-{2,}/g, '-')
    // Trim leading and trailing separators.
    .replace(/^-+|-+$/g, '');

  return normalized.length > 0 ? normalized.slice(0, 80) : null;
}

/** Normalises a list, dropping empties and preserving first-seen order without duplicates. */
export function normalizeTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of raw) {
    const normalized = normalizeTag(tag);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}
