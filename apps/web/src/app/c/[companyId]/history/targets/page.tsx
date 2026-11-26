import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import { TargetHistoryPage } from "@/features/history/target-history-page";

export default function HistoryTargetsRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TargetHistoryPage />
    </Suspense>
  );
}
