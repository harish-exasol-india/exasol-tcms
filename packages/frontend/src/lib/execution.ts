import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateRunRequest,
  environmentListSchema,
  metricsSchema,
  type RecordResultRequest,
  releaseListSchema,
  releaseReadinessSchema,
  runCaseSchema,
  runDetailSchema,
  runListSchema,
  testPlanListSchema,
  triageListSchema,
} from '@tcms/shared';
import { z } from 'zod';
import { ApiError, api } from './api.js';

const ok = z.object({ ok: z.boolean() });
const base = (projectId: string) => `/api/projects/${projectId}`;

export function usePlans(projectId: string) {
  return useQuery({
    queryKey: ['plans', projectId],
    queryFn: () => api.get(`${base(projectId)}/plans`, testPlanListSchema),
  });
}

export function useEnvironments(projectId: string) {
  return useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => api.get(`${base(projectId)}/environments`, environmentListSchema),
  });
}

export function useReleases(projectId: string) {
  return useQuery({
    queryKey: ['releases', projectId],
    queryFn: () => api.get(`${base(projectId)}/releases`, releaseListSchema),
  });
}

export function useRuns(projectId: string, releaseId?: string) {
  return useQuery({
    queryKey: ['runs', projectId, releaseId ?? null],
    queryFn: () =>
      api.get(
        `${base(projectId)}/runs${releaseId ? `?releaseId=${releaseId}` : ''}`,
        runListSchema,
      ),
    // Run progress changes while other testers work, so the list refreshes on its own.
    refetchInterval: 15_000,
  });
}

export function useRun(projectId: string, runId: string | null) {
  return useQuery({
    queryKey: ['run', projectId, runId],
    queryFn: () => api.get(`${base(projectId)}/runs/${runId}`, runDetailSchema),
    enabled: Boolean(runId),
    // Polling keeps a concurrent tester's progress approximately current (Decision 13).
    refetchInterval: 5_000,
  });
}

export function useRunCase(projectId: string, runId: string | null, runCaseId: string | null) {
  return useQuery({
    queryKey: ['run-case', projectId, runId, runCaseId],
    queryFn: () => api.get(`${base(projectId)}/runs/${runId}/cases/${runCaseId}`, runCaseSchema),
    enabled: Boolean(runId && runCaseId),
  });
}

export function useCreateRun(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRunRequest) =>
      api.post(`${base(projectId)}/runs`, z.object({ id: z.string() }), body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runs', projectId] }),
  });
}

export function useRecordResult(projectId: string, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { runCaseId: string } & RecordResultRequest) => {
      const { runCaseId, ...body } = input;
      return api.patch(
        `${base(projectId)}/runs/${runId}/cases/${runCaseId}`,
        z.object({ version: z.number() }),
        body,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['run', projectId, runId] });
      void queryClient.invalidateQueries({ queryKey: ['run-case', projectId, runId] });
    },
  });
}

export function useLinkDefect(projectId: string, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { runCaseId: string; issueKey: string; stepPosition?: number }) =>
      api.post(
        `${base(projectId)}/runs/${runId}/cases/${input.runCaseId}/defects`,
        z.object({ id: z.string(), issueKey: z.string(), url: z.string() }),
        { issueKey: input.issueKey, stepPosition: input.stepPosition ?? null },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run-case', projectId, runId] }),
  });
}

export function useCloseRun(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.post(`${base(projectId)}/runs/${runId}/close`, ok),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runs', projectId] }),
  });
}

export function useTriage(projectId: string, state?: string) {
  return useQuery({
    queryKey: ['triage', projectId, state ?? null],
    queryFn: () =>
      api.get(`${base(projectId)}/triage${state ? `?state=${state}` : ''}`, triageListSchema),
  });
}

export function useUpdateTriage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { triageId: string; state: string; note?: string }) =>
      api.patch(`${base(projectId)}/triage/${input.triageId}`, ok, {
        state: input.state,
        note: input.note ?? null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['triage', projectId] }),
  });
}

export function useReadiness(projectId: string, releaseId: string | null) {
  return useQuery({
    queryKey: ['readiness', projectId, releaseId],
    queryFn: () =>
      api.get(`${base(projectId)}/releases/${releaseId}/readiness`, releaseReadinessSchema),
    enabled: Boolean(releaseId),
  });
}

export function useCompleteSignOff(projectId: string, releaseId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (signOffId: string) =>
      api.post(`${base(projectId)}/sign-offs/${signOffId}/complete`, ok),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['readiness', projectId, releaseId] }),
  });
}

export function useAddSignOff(projectId: string, releaseId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post(`${base(projectId)}/releases/${releaseId}/sign-offs`, z.object({ id: z.string() }), {
        name,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['readiness', projectId, releaseId] }),
  });
}

export function useMetrics(projectId: string, days: number) {
  return useQuery({
    queryKey: ['metrics', projectId, days],
    queryFn: () => api.get(`${base(projectId)}/metrics?days=${days}`, metricsSchema),
  });
}

/**
 * Attachment upload. Sent as multipart rather than JSON so the file streams instead of
 * being base64-inflated by a third in the request body.
 */
export function useUploadAttachment(projectId: string, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { runCaseId: string; file: File; stepPosition?: number }) => {
      const form = new FormData();
      if (input.stepPosition !== undefined) form.append('stepPosition', String(input.stepPosition));
      form.append('file', input.file);

      const response = await fetch(
        `${base(projectId)}/runs/${runId}/cases/${input.runCaseId}/attachments`,
        { method: 'POST', credentials: 'include', body: form },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(response.status, body);
      return body as { id: string; filename: string };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run-case', projectId, runId] }),
  });
}

export function attachmentUrl(projectId: string, attachmentId: string): string {
  return `${base(projectId)}/attachments/${attachmentId}`;
}
