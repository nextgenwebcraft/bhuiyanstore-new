"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t, type TranslationKey } from "@bsd/i18n";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { companyHref, hubOfPath, visibleHubs } from "./navigation";

/**
 * The tab strip of the current hub, rendered once by the company shell above the page. Shown only
 * when the hub has two or more screens this person may open; scrolls sideways on phones.
 */
export function HubTabs({
  workspace,
  currentPath,
}: {
  workspace: CompanyWorkspace;
  currentPath: string;
}) {
  const hubId = hubOfPath(currentPath, workspace.company.isMaster)?.id;
  const hub = visibleHubs(workspace).find((h) => h.id === hubId);
  if (!hub || hub.tabs.length < 2) return null;
  return (
    <TabStrip
      label={t(hub.labelKey)}
      companyId={workspace.company.id}
      currentPath={currentPath}
      tabs={hub.tabs}
    />
  );
}

type Tab = { path: string; labelKey: TranslationKey };

/** Sideways-scrolling strip; an arrow shows on the side that still has hidden tabs. */
function TabStrip({
  label,
  companyId,
  currentPath,
  tabs,
}: {
  label: string;
  companyId: string;
  currentPath: string;
  tabs: readonly Tab[];
}) {
  const scroller = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // The observer reports the first size right after observe(), so no synchronous setState here.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  // Keep the open tab in view when the strip is wider than the screen.
  useEffect(() => {
    scroller.current
      ?.querySelector<HTMLElement>("[aria-current=page]")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [currentPath]);

  const scrollBy = (direction: -1 | 1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.6, behavior: "smooth" });
  };
  const arrow =
    "absolute inset-y-0 z-10 flex w-9 items-center justify-center bg-surface text-text-muted hover:text-text print:hidden";

  return (
    <div className="relative -mx-4 mb-5 sm:-mx-6 md:mx-0">
      <nav
        ref={scroller}
        aria-label={label}
        onScroll={measure}
        className="scrollbar-none overflow-x-auto border-b border-border px-4 sm:px-6 md:px-0 print:hidden"
      >
        <ul className="flex w-max min-w-full gap-1">
          {tabs.map((tab) => {
            const active = tab.path === currentPath;
            return (
              <li key={tab.path}>
                <Link
                  href={companyHref(companyId, tab.path)}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3.5 text-sm whitespace-nowrap transition-colors ${
                    active
                      ? "border-brand font-semibold text-brand"
                      : "border-transparent text-text-muted hover:border-border-strong hover:text-text"
                  }`}
                >
                  {t(tab.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {edge.left ? (
        <button
          type="button"
          aria-label={t("nav.tabs.scrollLeft")}
          onClick={() => scrollBy(-1)}
          className={`${arrow} left-0 border-r border-b border-border`}
        >
          <Chevron direction="left" />
        </button>
      ) : null}
      {edge.right ? (
        <button
          type="button"
          aria-label={t("nav.tabs.scrollRight")}
          onClick={() => scrollBy(1)}
          className={`${arrow} right-0 border-b border-l border-border`}
        >
          <Chevron direction="right" />
        </button>
      ) : null}
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "M12 4l-6 6 6 6" : "M8 4l6 6-6 6"} />
    </svg>
  );
}
