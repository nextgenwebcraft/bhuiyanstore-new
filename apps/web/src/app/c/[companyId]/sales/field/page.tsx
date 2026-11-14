import { redirect } from "next/navigation";

type Params = { params: Promise<{ companyId: string }> };

/** D112: মাঠ প্যানেল removed; old bookmarks land on দৈনিক বিক্রয় হিসাব. */
export default async function FieldRedirect({ params }: Params) {
  const { companyId } = await params;
  redirect(`/c/${companyId}/sales/daily-summaries`);
}
