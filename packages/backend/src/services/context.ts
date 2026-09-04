/**
 * The request context every service operation carries.
 *
 * Attribution is not optional and not a parameter a caller can forget: a service takes a
 * context, and the context is the only way to reach the acting principal. This is what makes
 * `created_via` provenance hold for the web, REST, and MCP paths alike (design Decision 10).
 */
import type { Origin } from '@tcms/shared';
import type { Principal } from '../auth/authorization.js';

export type RequestContext = {
  readonly principal: Principal;
  readonly now: Date;
};

export function contextFor(principal: Principal, now = new Date()): RequestContext {
  return { principal, now };
}

/** The interface a write came through, for the `origin` column on every mutation. */
export function originOf(ctx: RequestContext): Origin {
  return ctx.principal.origin;
}

/** The acting user, or null for a machine token (which has no human behind it). */
export function actorIdOf(ctx: RequestContext): string | null {
  return ctx.principal.kind === 'user' ? ctx.principal.userId : null;
}

/** The token id when a machine acted, for auditing CI writes. */
export function tokenIdOf(ctx: RequestContext): string | null {
  return ctx.principal.kind === 'token' ? ctx.principal.tokenId : null;
}
