import { useQuery } from '@tanstack/react-query';
import { coverageResponseSchema, uncoveredResponseSchema } from '@tcms/shared';
import { api } from './api.js';

export type CoverageFilters = {
  suiteId?: string | null;
  tags?: string[];
  release?: string;
  groupBy?: 'tag' | 'suite' | 'none';
};

function toQuery(filters: CoverageFilters): string {
  const params = new URLSearchParams();
  if (filters.suiteId) params.set('suiteId', filters.suiteId);
  if (filters.release) params.set('release', filters.release);
  if (filters.groupBy) params.set('groupBy', filters.groupBy);
  for (const tag of filters.tags ?? []) params.append('tag', tag);
  return params.toString();
}

export function useCoverage(projectId: string, filters: CoverageFilters) {
  return useQuery({
    queryKey: ['coverage', projectId, filters],
    queryFn: () =>
      api.get(`/api/projects/${projectId}/coverage?${toQuery(filters)}`, coverageResponseSchema),
  });
}

export function useUncoveredCases(projectId: string, filters: CoverageFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['uncovered', projectId, filters],
    queryFn: () =>
      api.get(
        `/api/projects/${projectId}/coverage/uncovered?${toQuery(filters)}`,
        uncoveredResponseSchema,
      ),
    enabled,
  });
}
