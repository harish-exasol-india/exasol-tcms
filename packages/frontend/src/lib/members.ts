import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AssignRoleRequest,
  assignableUserListSchema,
  projectMemberListSchema,
} from '@tcms/shared';
import { z } from 'zod';
import { api } from './api.js';

const okSchema = z.object({ ok: z.boolean() });

export function useMembers(projectId: string) {
  return useQuery({
    queryKey: ['members', projectId],
    queryFn: () => api.get(`/api/projects/${projectId}/members`, projectMemberListSchema),
  });
}

export function useAssignableUsers(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['assignable-users', projectId],
    queryFn: () => api.get(`/api/projects/${projectId}/assignable-users`, assignableUserListSchema),
    enabled,
  });
}

export function useAssignRole(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignRoleRequest) =>
      api.put(`/api/projects/${projectId}/members`, okSchema, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', projectId] }),
  });
}

export function useRevokeRole(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/api/projects/${projectId}/members/${userId}`, okSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', projectId] }),
  });
}
