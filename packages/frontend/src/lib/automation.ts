import { useQuery } from '@tanstack/react-query';
import { bindingReportSchema } from '@tcms/shared';
import { api } from './api.js';

export type BindingFilter = 'all' | 'fragile' | 'stale';

/**
 * Filtering happens on the server: at ~100k bindings, fetching every row to narrow it in
 * the browser sends two orders of magnitude more data than the table renders.
 */
export function useBindingReport(projectId: string, filter: BindingFilter = 'all') {
  return useQuery({
    queryKey: ['bindings', projectId, filter],
    queryFn: () =>
      api.get(
        `/api/projects/${projectId}/automation/bindings?filter=${filter}`,
        bindingReportSchema,
      ),
  });
}
