/**
 * `INSERT ... RETURNING` always yields a row, but the type is `T[]` so every call site would
 * otherwise need a non-null assertion. This turns "I know it's there" into a real check that
 * fails loudly rather than producing `undefined` deeper in the call stack.
 */
export function expectOne<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Expected ${what} to return exactly one row, got ${rows.length}`);
  }
  return row;
}
