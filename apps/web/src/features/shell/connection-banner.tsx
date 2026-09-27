"use client";

import { t } from "@bsd/i18n";
import { useOnlineStatus } from "./use-online-status";

export function ConnectionBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="alert" className="border-b border-error bg-surface px-4 py-2 text-sm">
      <strong className="text-error">{t("connection.lost")}</strong>{" "}
      <span className="text-text-muted">{t("connection.lostHint")}</span>
    </div>
  );
}
