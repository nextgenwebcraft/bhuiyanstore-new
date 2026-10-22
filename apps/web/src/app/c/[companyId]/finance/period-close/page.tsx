import { redirect } from "next/navigation";

/** Months close for every company together from the master panel now (D66). */
export default async function PeriodCloseRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  redirect(`/c/${companyId}`);
}
