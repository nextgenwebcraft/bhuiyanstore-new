"use client";

import type { Me } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "../ports/service-error";
import { ServiceProvider } from "../service-context";
import { createHttpService, type HttpDistributionService } from "./http-service";

export const SIGN_IN_PATH = "/login";
export const CHANGE_PASSWORD_PATH = "/change-password";

type Session = { me: Me; service: HttpDistributionService };

const AuthServiceContext = createContext<HttpDistributionService | null>(null);
const SessionContext = createContext<Session | null>(null);

const SESSION_KEY = ["session", "me"] as const;

function FullPage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-2xl p-4 sm:p-8">{children}</main>;
}

/**
 * Real-backend composition: HTTP adapter plus the session gate. Signed-out visitors go to the
 * sign-in page and a pending one-time password must be changed before anything else.
 */
export function HttpProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Any 401 re-checks the session; a failed check sends the visitor to sign in.
  const [service] = useState(() =>
    createHttpService(() => void queryClient.invalidateQueries({ queryKey: SESSION_KEY })),
  );
  const onSignIn = pathname === SIGN_IN_PATH;
  const me = useQuery({
    queryKey: SESSION_KEY,
    queryFn: ({ signal }) => service.getMe({ signal }),
    enabled: !onSignIn,
    staleTime: Infinity,
  });
  const signedOut = !onSignIn && me.isError && errorCodeOf(me.error) === "UNAUTHENTICATED";
  const mustChange = me.data?.mustChangePassword === true && pathname !== CHANGE_PASSWORD_PATH;

  useEffect(() => {
    if (signedOut) router.replace(SIGN_IN_PATH);
    else if (mustChange) router.replace(CHANGE_PASSWORD_PATH);
  }, [signedOut, mustChange, router]);

  const session = useMemo(() => (me.data ? { me: me.data, service } : null), [me.data, service]);
  const serviceValue = useMemo(
    () => (me.data ? { service, actorId: me.data.id } : null),
    [me.data, service],
  );

  let body: React.ReactNode;
  if (onSignIn) {
    body = children;
  } else if (me.isError && errorCodeOf(me.error) !== "UNAUTHENTICATED") {
    body = (
      <FullPage>
        <StatePanel
          tone="error"
          title={t(`error.${errorCodeOf(me.error)}`)}
          action={<Button onClick={() => void me.refetch()}>{t("state.retry")}</Button>}
        />
      </FullPage>
    );
  } else if (!session || !serviceValue || signedOut || mustChange) {
    body = (
      <FullPage>
        <ListSkeleton rows={3} />
      </FullPage>
    );
  } else {
    body = (
      <SessionContext.Provider value={session}>
        <ServiceProvider value={serviceValue}>{children}</ServiceProvider>
      </SessionContext.Provider>
    );
  }

  return <AuthServiceContext.Provider value={service}>{body}</AuthServiceContext.Provider>;
}

/** Null in demo mode, where there is nothing to sign in to. */
export function useAuthService(): HttpDistributionService | null {
  return useContext(AuthServiceContext);
}

/** The signed-in person, or null in demo mode. */
export function useSession(): Session | null {
  return useContext(SessionContext);
}
