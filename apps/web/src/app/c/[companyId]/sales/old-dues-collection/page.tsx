import { redirect } from "next/navigation";

/** Shop due and collection moved onto the DSR day sheet (D57); keep old links working. */
export default async function OldDuesCollectionRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  redirect(`/c/${companyId}/sales/daily-summaries`);
}
