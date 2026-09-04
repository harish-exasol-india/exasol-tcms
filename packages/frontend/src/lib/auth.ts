import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CurrentUser, currentUserSchema, type SignInRequest } from '@tcms/shared';
import { z } from 'zod';
import { ApiError, api } from './api.js';

const okSchema = z.object({ ok: z.boolean() });

export const currentUserQueryKey = ['auth', 'me'] as const;

/**
 * The signed-in user, or null. A 401 is a valid answer ("nobody is signed in"), not an
 * error state, so it resolves rather than rejecting.
 */
export function useCurrentUser() {
  return useQuery<CurrentUser | null>({
    queryKey: currentUserQueryKey,
    queryFn: async () => {
      try {
        return await api.get('/api/auth/me', currentUserSchema);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: SignInRequest) =>
      api.post('/api/auth/sign-in', okSchema, credentials),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: currentUserQueryKey }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/auth/sign-out', okSchema),
    onSuccess: () => queryClient.setQueryData(currentUserQueryKey, null),
  });
}
