import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import { StockTrackingPage } from "@/features/inventory/stock-tracking-page";

export default function HistoryStockTrackingRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StockTrackingPage />
    </Suspense>
  );
}
