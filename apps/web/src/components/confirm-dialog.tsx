"use client";

import { t } from "@bsd/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FormDialog } from "./form-dialog";

export type ConfirmOptions = {
  title?: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * App-wide confirm dialog (replaces `window.confirm`). Call `useConfirm()` from any client
 * component under `ConfirmProvider`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  function close(ok: boolean) {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(ok);
  }

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <FormDialog
        open={pending !== null}
        title={pending?.title ?? t("common.confirmTitle")}
        pending={false}
        submitLabel={pending?.confirmLabel ?? t("common.confirm")}
        onSubmit={() => close(true)}
        onClose={() => close(false)}
      >
        {pending ? (
          <div className="flex flex-col gap-2 text-sm text-text-muted">
            <p className="whitespace-pre-wrap text-text">{pending.message}</p>
            {pending.detail ? (
              <p className="whitespace-pre-wrap text-text-muted">{pending.detail}</p>
            ) : null}
          </div>
        ) : null}
      </FormDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return confirm;
}
