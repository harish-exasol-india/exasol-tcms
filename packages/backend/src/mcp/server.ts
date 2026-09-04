/**
 * MCP endpoint, mounted in-process at /mcp (design Decision 10).
 *
 * In-process rather than a separate container specifically so that authorisation cannot
 * drift: a tool call reaches the same `authorize` function as a REST call, via the same
 * `Principal` produced by the same authenticator. There is no path by which an agent could
 * hold rights a human with the same token does not.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccessDeniedError } from '../auth/authorization.js';
import { unauthorized } from '../http/errors.js';
import { zodToJsonSchema } from './json-schema.js';
import { type McpDeps, TOOLS } from './tools.js';

const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullish(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const PROTOCOL_VERSION = '2025-06-18';

export function registerMcpRoutes(app: FastifyInstance, deps: McpDeps): void {
  /**
   * Streamable HTTP transport: a single POST endpoint speaking JSON-RPC. Deliberately not
   * stateful — each call carries its own credentials, so there is no session to hijack.
   */
  app.post('/mcp', async (request, reply) => {
    const principal = request.principal;
    if (!principal) throw unauthorized('MCP requires authentication');

    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
    const { id, method, params } = parsed.data;
    const respond = (result: unknown) => reply.send({ jsonrpc: '2.0', id: id ?? null, result });
    const fail = (code: number, message: string) =>
      reply.send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

    switch (method) {
      case 'initialize':
        return respond({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'exasol-tcms', version: '0.1.0' },
        });

      case 'notifications/initialized':
        return reply.status(202).send();

      case 'ping':
        return respond({});

      case 'tools/list':
        return respond({
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: zodToJsonSchema(tool.inputSchema),
          })),
        });

      case 'tools/call': {
        const name = String(params?.['name'] ?? '');
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return fail(-32602, `Unknown tool '${name}'`);

        const args = (params?.['arguments'] ?? {}) as Record<string, unknown>;
        const validated = tool.inputSchema.safeParse(args);
        if (!validated.success) {
          return respond({
            isError: true,
            content: [
              {
                type: 'text',
                text: `Invalid arguments: ${validated.error.issues
                  .map((i) => `${i.path.join('.')}: ${i.message}`)
                  .join('; ')}`,
              },
            ],
          });
        }

        const parsedArgs = validated.data as Record<string, unknown>;

        // Authorisation: the same function, matrix and principal as every other interface.
        if (typeof parsedArgs['projectId'] === 'string') {
          const projectId = parsedArgs['projectId'];
          try {
            const resolved = /^[0-9a-f-]{36}$/i.test(projectId)
              ? projectId
              : await (async () => {
                  const rows = await deps.db.query.projects.findFirst({
                    where: (p, { eq }) => eq(p.key, projectId),
                  });
                  return rows?.id ?? projectId;
                })();
            await deps.authorizer.authorize(principal, tool.permission, resolved);
          } catch (error) {
            if (error instanceof AccessDeniedError) {
              return respond({
                isError: true,
                content: [{ type: 'text', text: 'Not found' }],
              });
            }
            throw error;
          }
        }

        try {
          const result = await tool.handler(parsedArgs, principal, deps);
          return respond({
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result as Record<string, unknown>,
          });
        } catch (error) {
          if (error instanceof AccessDeniedError) {
            return respond({ isError: true, content: [{ type: 'text', text: 'Not found' }] });
          }
          request.log.error({ err: error, tool: name }, 'mcp tool failed');
          return respond({
            isError: true,
            content: [
              {
                type: 'text',
                text: error instanceof Error ? error.message : 'Tool execution failed',
              },
            ],
          });
        }
      }

      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  });
}
