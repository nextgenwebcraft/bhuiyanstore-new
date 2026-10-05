"use client";

import { PageError, type ErrorBoundaryProps } from "@/components/page-error";

export default function RootPageError(props: ErrorBoundaryProps) {
  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8">
      <PageError {...props} />
    </main>
  );
}
