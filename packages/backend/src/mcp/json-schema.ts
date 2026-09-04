/**
 * Minimal Zod → JSON Schema conversion for MCP tool declarations.
 *
 * Hand-rolled rather than pulled from a library because MCP needs only the small subset the
 * tool inputs actually use, and because a dependency that introspects types would be at
 * risk from the TypeScript 7 compiler-API gap recorded in design Decision 23.
 */
import type { z } from 'zod';

type JsonSchema = Record<string, unknown>;

function convert(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName?: string; [key: string]: unknown };

  switch (def['typeName']) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def['values'] as string[] };
    case 'ZodArray':
      return { type: 'array', items: convert(def['type'] as z.ZodTypeAny) };
    case 'ZodOptional':
    case 'ZodNullable':
      return convert(def['innerType'] as z.ZodTypeAny);
    case 'ZodDefault': {
      const inner = convert(def['innerType'] as z.ZodTypeAny);
      const defaultValue = (def['defaultValue'] as () => unknown)();
      return { ...inner, default: defaultValue };
    }
    case 'ZodObject':
      return objectSchema(schema as z.ZodObject<z.ZodRawShape>);
    case 'ZodRecord':
      return { type: 'object' };
    default:
      return {};
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema._def as { typeName?: string })['typeName'];
  return typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable';
}

function objectSchema(schema: z.ZodObject<z.ZodRawShape>): JsonSchema {
  const shape = schema.shape;
  const properties: JsonSchema = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const field = value as z.ZodTypeAny;
    const converted = convert(field);
    const description = field.description;
    properties[key] = description ? { ...converted, description } : converted;
    if (!isOptional(field)) required.push(key);
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const converted = convert(schema);
  // MCP requires an object at the top level of a tool's input schema.
  return converted['type'] === 'object' ? converted : { type: 'object', properties: {} };
}
