"use client";

import { t } from "@bsd/i18n";
import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { THEME_STORAGE_KEY } from "./theme-script";

type Theme = "dark" | "light";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const readTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

/** Sun/moon switch in the top bar; the choice is kept on this device. */
export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "dark");

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode: the switch still applies for this visit.
    }
  }

  const label = theme === "dark" ? t("theme.toLight") : t("theme.toDark");
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} className="size-[18px]" />
    </button>
  );
}
