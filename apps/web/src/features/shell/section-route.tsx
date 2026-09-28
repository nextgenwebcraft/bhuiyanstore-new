"use client";

import { notFound } from "next/navigation";
import { findSectionById } from "./navigation";
import { ModuleLandingPage } from "./module-landing-page";
import { NavGate } from "./nav-gate";

/**
 * Every registered path below `/c/{companyId}` that isn't the dashboard. A single-segment path
 * matching a section id (e.g. "purchases") is that module's card-grid landing page; any other
 * path is a leaf screen guarded by NavGate. Every real leaf path has two segments
 * ("purchases/orders"), so this split is unambiguous.
 */
export function SectionRoute({ path }: { path: string }) {
  const section = findSectionById(path);
  if (section) return <ModuleLandingPage sectionId={path} />;

  const isLeafPath = path.includes("/");
  if (!isLeafPath) notFound();
  return <NavGate path={path} />;
}
