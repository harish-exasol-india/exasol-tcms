/**
 * Turns an incoming request into a Principal.
 *
 * Two credential kinds are accepted: a session cookie for humans and a bearer API token for
 * machines. Both converge on the same `Principal`, so downstream code — including MCP —
 * consults one authorisation function and cannot acquire a second path (Decision 10).
 */
import '@fastify/cookie';
import type { FastifyRequest } from 'fastify';
import type { Principal } from '../auth/authorization.js';
import type { SessionService } from '../auth/sessions.js';
import type { TokenService } from '../auth/token-service.js';
import { parseBearer } from '../auth/tokens.js';

export const SESSION_COOKIE = 'tcms_session';

export type Authenticator = (request: FastifyRequest) => Promise<Principal | null>;

export function createAuthenticator(deps: {
  sessions: SessionService;
  tokens: TokenService;
  /** Marks requests arriving on the MCP endpoint so provenance records 'mcp'. */
  isMcpRequest?: (request: FastifyRequest) => boolean;
}): Authenticator {
  return async (request) => {
    const bearer = parseBearer(request.headers.authorization);
    if (bearer) {
      const token = await deps.tokens.verify(bearer);
      if (!token) return null;
      return {
        kind: 'token',
        tokenId: token.tokenId,
        projectId: token.projectId,
        scopes: token.scopes,
        origin: 'api',
      };
    }

    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (!sessionId) return null;
    const session = await deps.sessions.resolve(sessionId);
    if (!session) return null;

    return {
      kind: 'user',
      userId: session.userId,
      origin: deps.isMcpRequest?.(request) ? 'mcp' : 'ui',
    };
  };
}
