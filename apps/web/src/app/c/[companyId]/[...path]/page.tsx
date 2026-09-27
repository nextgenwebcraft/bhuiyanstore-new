import { NavGate } from "@/features/shell/nav-gate";

/** Every registered navigation path without a dedicated screen yet; unknown paths 404. */
export default async function SectionRoute({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return <NavGate path={path.join("/")} />;
}
