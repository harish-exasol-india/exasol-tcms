import { z } from 'zod';

/**
 * All configuration arrives through the environment; nothing is read from the container
 * filesystem (design Decision 22). Parsing fails fast at startup rather than surfacing a
 * missing value later as a runtime error.
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:8080'),
  COOKIE_SECRET: z.string().min(16).default('development-cookie-secret-change-me'),
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400),
  RETENTION_MONTHS: z.coerce.number().int().positive().default(12),
  BINDING_STALE_DAYS: z.coerce.number().int().positive().default(30),
  S3_ENDPOINT: z.string().default('http://minio:9000'),
  S3_BUCKET: z.string().default('tcms-attachments'),
  S3_ACCESS_KEY: z.string().default('tcmsadmin'),
  S3_SECRET_KEY: z.string().default('tcmsadmin'),
  S3_REGION: z.string().default('us-east-1'),
  JIRA_BASE_URL: z.string().default('https://exasol.atlassian.net'),
  JIRA_KEY_PATTERN: z.string().default('^[A-Z][A-Z0-9]+-\\d+$'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}
