"use client";

import { t } from "@bsd/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { SIGN_IN_PATH, useSession } from "@/data/http/http-provider";
import { DemoBar } from "@/demo/demo-bar";
import { useOptionalDemoControls } from "@/demo/demo-provider";
import { ThemeToggle } from "./theme";

function SessionBar() {
  const session = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  const { name } = session.me;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex size-8 items-center justify-center rounded-full bg-brand/10 text-[13px] font-semibold text-brand ring-1 ring-brand/15"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden flex-col leading-tight sm:flex">
          <span className="text-[11px] text-text-muted">{t("auth.signedInAs")}</span>
          <span className="font-medium text-text">{name}</span>
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        title={t("auth.signOut")}
        onClick={async () => {
          setBusy(true);
          await session.service.signOut();
          router.replace(SIGN_IN_PATH);
          // Nothing of the previous user may stay cached for the next one.
          queryClient.clear();
        }}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
      >
        <Icon name="logout" className="size-[18px]" />
        <span className="hidden md:inline">{t("auth.signOut")}</span>
      </button>
    </div>
  );
}

/** Demo user switcher in demo mode, the signed-in user and sign-out with the real backend. */
export function TopBar() {
  const demo = useOptionalDemoControls();
  return (
    <div className="flex items-center gap-1.5">
      <ThemeToggle />
      {demo ? <DemoBar /> : <SessionBar />}
    </div>
  );
}
