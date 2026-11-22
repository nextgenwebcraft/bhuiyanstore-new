import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import { PartnerPaymentsPage } from "@/features/master/partner-payments-page";

export default function PartnerPaymentsRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PartnerPaymentsPage />
    </Suspense>
  );
}
