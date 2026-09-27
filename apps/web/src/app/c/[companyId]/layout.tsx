import { CompanyShell } from "@/features/shell/company-shell";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  // Keyed remount = the company state boundary (guide section 4.2 step 4).
  return (
    <CompanyShell key={companyId} companyId={companyId}>
      {children}
    </CompanyShell>
  );
}
