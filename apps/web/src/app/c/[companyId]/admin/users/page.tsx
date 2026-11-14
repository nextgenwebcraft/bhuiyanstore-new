import { redirect } from "next/navigation";

type Params = { params: Promise<{ companyId: string }> };

/** D113: logins live on master আমাদের স্টাফ; old bookmarks land there. */
export default async function UsersRedirect({ params }: Params) {
  const { companyId } = await params;
  redirect(`/c/${companyId}/masters/staff`);
}
