import { SectionRoute } from "@/features/shell/section-route";

/** Every registered navigation path without a dedicated screen yet; unknown paths 404. */
export default async function SectionRoutePage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return <SectionRoute path={path.join("/")} />;
}
