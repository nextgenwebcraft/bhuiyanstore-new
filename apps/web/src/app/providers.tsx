"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ServiceError } from "@/data/ports/service-error";
import { DemoProvider } from "@/demo/demo-provider";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Typed failures such as COMPANY_NOT_FOUND are final; only unknown/retryable ones retry.
        retry: (failureCount, error) =>
          failureCount < 2 && (!(error instanceof ServiceError) || error.retryable),
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <DemoProvider>{children}</DemoProvider>
    </QueryClientProvider>
  );
}
