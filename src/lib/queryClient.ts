import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,        // 5 minutos
      gcTime: 1000 * 60 * 30,          // 30 minutos
      retry: (failureCount, error) => {
        // No reintentar errores de validación o no encontrado
        const apiError = error as { code?: string };
        if (
          apiError?.code === "VALIDATION_ERROR" ||
          apiError?.code === "NOT_FOUND"
        ) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
