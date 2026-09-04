import { describe, expect, it } from 'vitest';
import { normalizeTag, normalizeTags } from './tags.js';

describe('tag normalisation', () => {
  it('converges the case and whitespace variants that split a tag', () => {
    // The exact failure mode Decision 2 accepts free-form tags in spite of.
    const variants = ['  End-To-End  ', 'END-TO-END', 'end to end', 'End_To_End', 'end-to-end'];
    const normalized = new Set(variants.map(normalizeTag));
    expect([...normalized]).toEqual(['end-to-end']);
  });

  it('collapses internal whitespace and repeated separators', () => {
    expect(normalizeTag('release   stream')).toBe('release-stream');
    expect(normalizeTag('e2e--web')).toBe('e2e-web');
    expect(normalizeTag('--nightly--')).toBe('nightly');
  });

  it('preserves meaningful punctuation such as version streams', () => {
    expect(normalizeTag('release-8.0.x')).toBe('release-8.0.x');
    expect(normalizeTag('7.1.x')).toBe('7.1.x');
  });

  it('returns null for input with nothing usable', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('---')).toBeNull();
  });

  it('caps length so a pasted paragraph cannot become a tag', () => {
    expect(normalizeTag('a'.repeat(200))).toHaveLength(80);
  });

  it('deduplicates a list while preserving first-seen order', () => {
    expect(normalizeTags(['E2E', 'smoke', 'e2e', '  E2E  ', 'security'])).toEqual([
      'e2e',
      'smoke',
      'security',
    ]);
  });

  it('drops unusable entries from a list rather than failing', () => {
    expect(normalizeTags(['valid', '', '   ', 'also-valid'])).toEqual(['valid', 'also-valid']);
  });

  it('is idempotent', () => {
    for (const tag of ['End To End', 'RELEASE_8.0.X', '  smoke  ']) {
      const once = normalizeTag(tag) as string;
      expect(normalizeTag(once)).toBe(once);
    }
  });
});
