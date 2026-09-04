import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CaseListQuery,
  type CreateCaseRequest,
  caseHistoryResponseSchema,
  caseListResponseSchema,
  sharedStepListSchema,
  suiteTreeSchema,
  tagListSchema,
  testCaseSchema,
  type UpdateCaseRequest,
} from '@tcms/shared';
import { z } from 'zod';
import { api } from './api.js';

const okSchema = z.object({ ok: z.boolean() });
const base = (projectId: string) => `/api/projects/${projectId}`;

export function useSuites(projectId: string) {
  return useQuery({
    queryKey: ['suites', projectId],
    queryFn: () => api.get(`${base(projectId)}/suites`, suiteTreeSchema),
  });
}

export type CaseFilters = Pick<CaseListQuery, 'suiteId' | 'search' | 'automated'> & {
  tags?: string[];
};

function filtersToQuery(filters: CaseFilters, limit: number): string {
  const params = new URLSearchParams();
  if (filters.suiteId) params.set('suiteId', filters.suiteId);
  if (filters.search) params.set('search', filters.search);
  if (filters.automated) params.set('automated', filters.automated);
  for (const tag of filters.tags ?? []) params.append('tag', tag);
  params.set('limit', String(limit));
  return params.toString();
}

/**
 * Cases are fetched a page at a time and appended, so a 25,000-case project loads
 * progressively instead of blocking on one enormous response.
 */
export function useCases(projectId: string, filters: CaseFilters, pageSize = 200) {
  return useInfiniteQuery({
    queryKey: ['cases', projectId, filters, pageSize],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = filtersToQuery(filters, pageSize);
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
      return api.get(`${base(projectId)}/cases?${query}${cursor}`, caseListResponseSchema);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useCase(projectId: string, caseId: string | null) {
  return useQuery({
    queryKey: ['case', projectId, caseId],
    queryFn: () => api.get(`${base(projectId)}/cases/${caseId}`, testCaseSchema),
    enabled: Boolean(caseId),
  });
}

export function useCaseHistory(projectId: string, caseId: string | null) {
  return useQuery({
    queryKey: ['case-history', projectId, caseId],
    queryFn: () => api.get(`${base(projectId)}/cases/${caseId}/history`, caseHistoryResponseSchema),
    enabled: Boolean(caseId),
  });
}

export function useTags(projectId: string) {
  return useQuery({
    queryKey: ['tags', projectId],
    queryFn: () => api.get(`${base(projectId)}/tags`, tagListSchema),
  });
}

export function useSharedSteps(projectId: string) {
  return useQuery({
    queryKey: ['shared-steps', projectId],
    queryFn: () => api.get(`${base(projectId)}/shared-steps`, sharedStepListSchema),
  });
}

function invalidateCases(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: ['cases', projectId] });
  void queryClient.invalidateQueries({ queryKey: ['suites', projectId] });
  void queryClient.invalidateQueries({ queryKey: ['tags', projectId] });
}

export function useCreateCase(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCaseRequest) =>
      api.post(`${base(projectId)}/cases`, testCaseSchema, body),
    onSuccess: () => invalidateCases(queryClient, projectId),
  });
}

export function useUpdateCase(projectId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCaseRequest) =>
      api.patch(`${base(projectId)}/cases/${caseId}`, testCaseSchema, body),
    onSuccess: () => {
      invalidateCases(queryClient, projectId);
      void queryClient.invalidateQueries({ queryKey: ['case', projectId, caseId] });
      void queryClient.invalidateQueries({ queryKey: ['case-history', projectId, caseId] });
    },
  });
}

export function useDeleteCase(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.delete(`${base(projectId)}/cases/${caseId}`, okSchema),
    onSuccess: () => invalidateCases(queryClient, projectId),
  });
}
