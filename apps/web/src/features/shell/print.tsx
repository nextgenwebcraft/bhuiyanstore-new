"use client";

import { formatBusinessDate, formatDateTime, t } from "@bsd/i18n";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/button";
import { useCurrentWorkspace } from "./workspace-context";

/** Prints the current screen; the shell, navigation and actions are hidden by the print CSS. */
export function PrintButton() {
  return (
    <Button className="print:hidden" onClick={() => window.print()}>
      {t("print.button")}
    </Button>
  );
}

const subscribe = () => () => {};

/** Company, screen, period and print time; only on paper. */
export function PrintHeader({
  title,
  from,
  to,
}: {
  title: string;
  from?: string | undefined;
  to?: string | undefined;
}) {
  const { company } = useCurrentWorkspace();
  const printedAt = useSyncExternalStore(
    subscribe,
    () => formatDateTime(new Date()),
    () => "",
  );
  let period = "";
  if (from && to && from !== to) {
    period = `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;
  } else if (from ?? to) period = formatBusinessDate((from ?? to) as string);
  return (
    <div className="mb-4 hidden border-b border-border pb-2 print:block">
      <div className="text-lg font-semibold">{company.name}</div>
      <div className="font-medium">{title}</div>
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        {period ? (
          <span>
            {t("print.period")}: {period}
          </span>
        ) : null}
        <span>
          {t("print.printedAt")}: {printedAt}
        </span>
      </div>
    </div>
  );
}
