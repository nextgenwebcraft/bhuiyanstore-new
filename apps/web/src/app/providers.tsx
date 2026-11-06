"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { HttpProvider } from "@/data/http/http-provider";
import { ServiceError } from "@/data/ports/service-error";
import { DemoProvider } from "@/demo/demo-provider";

/** `http` uses the real `/api/v1` backend; anything else keeps the in-memory demo. */
const dataSource = process.env.NEXT_PUBLIC_DATA_SOURCE === "http" ? "http" : "mock";

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
  const DataProvider = dataSource === "http" ? HttpProvider : DemoProvider;
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <DataProvider>{children}</DataProvider>
      </ConfirmProvider>
    </QueryClientProvider>
  );
}
