import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQuery, type UseQueryOptions } from "@tanstack/react-query";

// ─── Tipo de error del API (espejo del ApiError en Rust) ──────────────────────

export interface ApiError {
  code: string;
  message: string;
}

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}

// ─── Hook genérico de query (lectura) ────────────────────────────────────────

export function useTauriQuery<TData>(
  queryKey: readonly unknown[],
  command: string,
  args?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<TData, ApiError>, "queryKey" | "queryFn">
) {
  return useQuery<TData, ApiError>({
    queryKey,
    queryFn: () => invoke<TData>(command, args),
    ...options,
  });
}

// ─── Hook genérico de mutation (escritura) ───────────────────────────────────

export function useTauriMutation<TData, TVariables>(
  command: string,
  options?: {
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: ApiError) => void;
  }
) {
  return useMutation<TData, ApiError, TVariables>({
    mutationFn: (variables) =>
      invoke<TData>(command, variables as Record<string, unknown>),
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}
