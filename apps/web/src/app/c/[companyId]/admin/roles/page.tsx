import { redirect } from "next/navigation";

type Params = { params: Promise<{ companyId: string }> };

/** D113: fixed roles; credentials managed on master আমাদের স্টাফ. */
export default async function RolesRedirect({ params }: Params) {
  const { companyId } = await params;
  redirect(`/c/${companyId}/masters/staff`);
}
