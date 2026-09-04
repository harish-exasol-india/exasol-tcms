/**
 * Contracts shared by the frontend and backend.
 *
 * Everything crossing the HTTP boundary is defined here once as a Zod schema and
 * consumed as an inferred type on both sides, so a request or response shape has a
 * single definition (design Decision 18).
 */

export * from './contracts/index.js';
export * from './permissions.js';
export * from './roles.js';
export * from './tags.js';
