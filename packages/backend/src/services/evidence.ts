/**
 * Evidence and defect links (AC 5).
 *
 * Attachments are manual-run evidence only: automated evidence is an accepted gap, since
 * JUnit XML carries no attachment mechanism (design Decision 8).
 *
 * A defect is a Jira issue *reference*, nothing more. No Jira API is called in either
 * direction (Decision 5), so `linkedAt` is the only age fact the system owns — which is why
 * AC 4's age banding is computed from it rather than from Jira's created date.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { badRequest, notFound, payloadTooLarge } from '../http/errors.js';
import type { RequestContext } from './context.js';
import type { ObjectStore } from './storage.js';

export async function addAttachment(
  db: Database,
  store: ObjectStore,
  ctx: RequestContext,
  input: {
    projectId: string;
    runId: string;
    runCaseId: string;
    stepPosition?: number | null;
    filename: string;
    contentType: string;
    body: Buffer;
    maxBytes: number;
  },
) {
  if (input.body.length === 0) throw badRequest('The uploaded file is empty');
  if (input.body.length > input.maxBytes) {
    // Rejected before anything is written, so no partial object is left behind.
    throw payloadTooLarge(`File exceeds the ${Math.round(input.maxBytes / 1024 / 1024)}MB limit`);
  }

  const [runCase] = await db
    .select({ id: s.runCases.id })
    .from(s.runCases)
    .innerJoin(s.runs, eq(s.runs.id, s.runCases.runId))
    .where(
      and(
        eq(s.runCases.id, input.runCaseId),
        eq(s.runCases.runId, input.runId),
        eq(s.runs.projectId, input.projectId),
      ),
    );
  if (!runCase) throw notFound('Run case not found');

  const objectKey = `runs/${input.runId}/${input.runCaseId}/${randomUUID()}-${input.filename.replace(/[^\w.-]/g, '_')}`;
  await store.put(objectKey, input.body, input.contentType);

  return expectOne(
    await db
      .insert(s.attachments)
      .values({
        runId: input.runId,
        runCaseId: input.runCaseId,
        stepPosition: input.stepPosition ?? null,
        objectKey,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.body.length,
        uploadedBy: ctx.principal.kind === 'user' ? ctx.principal.userId : null,
        uploadedAt: ctx.now,
      })
      .returning(),
    'attachment insert',
  );
}

/** Resolves an attachment, enforcing that it belongs to the caller's project. */
export async function getAttachment(db: Database, projectId: string, attachmentId: string) {
  const [row] = await db
    .select({
      objectKey: s.attachments.objectKey,
      filename: s.attachments.filename,
      contentType: s.attachments.contentType,
      sizeBytes: s.attachments.sizeBytes,
    })
    .from(s.attachments)
    .innerJoin(s.runs, eq(s.runs.id, s.attachments.runId))
    .where(and(eq(s.attachments.id, attachmentId), eq(s.runs.projectId, projectId)));
  if (!row) throw notFound('Attachment not found');
  return row;
}

export async function deleteAttachmentsForRuns(
  db: Database,
  store: ObjectStore,
  runIds: string[],
): Promise<number> {
  if (runIds.length === 0) return 0;
  const rows = await db
    .select({ objectKey: s.attachments.objectKey })
    .from(s.attachments)
    .where(inArray(s.attachments.runId, runIds));
  await store.deleteMany(rows.map((r) => r.objectKey));
  await db.delete(s.attachments).where(inArray(s.attachments.runId, runIds));
  return rows.length;
}

export function assertIssueKey(issueKey: string, pattern: string): void {
  if (!new RegExp(pattern).test(issueKey)) {
    throw badRequest(
      `'${issueKey}' is not a valid issue key. Expected the form PROJECT-123.`,
      'INVALID_ISSUE_KEY',
    );
  }
}

export async function linkDefect(
  db: Database,
  ctx: RequestContext,
  input: {
    projectId: string;
    runId: string;
    runCaseId: string;
    issueKey: string;
    stepPosition?: number | null;
    keyPattern: string;
  },
) {
  assertIssueKey(input.issueKey, input.keyPattern);

  const [runCase] = await db
    .select({ id: s.runCases.id })
    .from(s.runCases)
    .innerJoin(s.runs, eq(s.runs.id, s.runCases.runId))
    .where(
      and(
        eq(s.runCases.id, input.runCaseId),
        eq(s.runCases.runId, input.runId),
        eq(s.runs.projectId, input.projectId),
      ),
    );
  if (!runCase) throw notFound('Run case not found');

  const inserted = await db
    .insert(s.defectLinks)
    .values({
      runCaseId: input.runCaseId,
      stepPosition: input.stepPosition ?? null,
      issueKey: input.issueKey.toUpperCase(),
      linkedBy: ctx.principal.kind === 'user' ? ctx.principal.userId : null,
      linkedAt: ctx.now,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    throw badRequest('That issue is already linked to this case', 'DUPLICATE_LINK');
  }
  return inserted[0];
}

export async function unlinkDefect(db: Database, projectId: string, defectLinkId: string) {
  const [row] = await db
    .select({ id: s.defectLinks.id })
    .from(s.defectLinks)
    .innerJoin(s.runCases, eq(s.runCases.id, s.defectLinks.runCaseId))
    .innerJoin(s.runs, eq(s.runs.id, s.runCases.runId))
    .where(and(eq(s.defectLinks.id, defectLinkId), eq(s.runs.projectId, projectId)));
  if (!row) throw notFound('Defect link not found');
  await db.delete(s.defectLinks).where(eq(s.defectLinks.id, defectLinkId));
}
