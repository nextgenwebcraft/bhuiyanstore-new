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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning bg-surface px-4 py-2 text-sm">
      <span className="rounded-full border border-warning px-2 py-0.5 font-medium text-warning">
        {t("app.demoData")}
      </span>
      <label htmlFor={selectId} className="text-text-muted">
        {t("demo.user")}
      </label>
      <select
        id={selectId}
        value={actorId}
        onChange={(event) => {
          setActor(event.target.value);
          // The new user may not belong to the current company; start from their company list.
          router.push("/");
        }}
        className="min-h-9 rounded-md border border-border bg-surface px-2"
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
        className="min-h-9 rounded-md border border-border px-3 hover:bg-surface-muted"
      >
        {t("demo.reset")}
      </button>
    </div>
  );
}
