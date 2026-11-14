import { redirect } from "next/navigation";

/** Damage goes to the company as a ড্যামেজ জমা deposit now (D63); keep old links working. */
export default async function DamageRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  redirect(`/c/${companyId}/finance/supplier-deposits`);
}
