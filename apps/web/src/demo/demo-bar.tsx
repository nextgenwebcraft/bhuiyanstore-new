"use client";

import { t } from "@bsd/i18n";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { useDemoControls } from "./demo-provider";

/** Persistent demo indicator with user switching and reset (guide section 6.1). */
export function DemoBar() {
  const { users, actorId, setActor, reset } = useDemoControls();
  const router = useRouter();
  const selectId = useId();

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning ring-1 ring-warning/30">
        {t("app.demoData")}
      </span>
      <label htmlFor={selectId} className="sr-only">
        {t("demo.user")}
      </label>
      <select
        id={selectId}
        value={actorId}
        title={t("demo.user")}
        onChange={(event) => {
          setActor(event.target.value);
          // The new user may not belong to the current company; start from their company list.
          router.push("/");
        }}
        className="min-h-9 rounded-lg border border-border bg-surface px-2 text-text"
      >
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t("demo.resetConfirm"))) reset();
        }}
        className="min-h-9 rounded-lg px-2.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        {t("demo.reset")}
      </button>
    </div>
  );
}
