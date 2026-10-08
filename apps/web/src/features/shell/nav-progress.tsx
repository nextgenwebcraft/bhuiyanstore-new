"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function isInternalNavigation(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, location.href);
  return url.origin === location.origin && url.pathname !== location.pathname;
}

/**
 * A thin action-colored bar at the top of the window that starts the moment an internal link is
 * clicked and completes when the new page renders, so a click never feels ignored.
 */
export function NavProgress() {
  const pathname = usePathname();
  /** The path a navigation started from; the bar completes once the path differs. */
  const [startedFrom, setStartedFrom] = useState<string | null>(null);
  const state = startedFrom === null ? "idle" : startedFrom === pathname ? "loading" : "done";

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (isInternalNavigation(event)) setStartedFrom(location.pathname);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (state === "idle") return;
    // Finish shortly after arrival; give up after 15 s if the navigation never lands.
    const timer = setTimeout(() => setStartedFrom(null), state === "done" ? 320 : 15_000);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5">
      <div
        className={`h-full origin-left bg-brand shadow-[0_0_8px_var(--action)] ${
          state === "loading"
            ? "scale-x-[0.8] opacity-100 transition-transform duration-[2500ms] ease-out"
            : state === "done"
              ? "scale-x-100 opacity-0 transition-[transform,opacity] duration-300"
              : "scale-x-0 opacity-0"
        }`}
      />
    </div>
  );
}
