"use client";

import { PageError, type ErrorBoundaryProps } from "@/components/page-error";

export default function CompanyPageError(props: ErrorBoundaryProps) {
  return <PageError {...props} />;
}
