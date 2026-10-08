import { PageSkeleton } from "@/components/skeleton";

/**
 * Prefetched with each link, so a click swaps the content area to this placeholder at once while
 * the next page loads; the company shell (sidebar and header) stays in place.
 */
export default function CompanyPageLoading() {
  return <PageSkeleton />;
}
