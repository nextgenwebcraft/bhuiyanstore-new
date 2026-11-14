"use client";

import { t } from "@bsd/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { PasswordInput } from "@/components/password-input";
import { useAuthService } from "@/data/http/http-provider";
import { errorCodeOf } from "@/data/ports/service-error";

export function SignInPage() {
  const service = useAuthService();
  const queryClient = useQueryClient();
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!service || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await service.signIn(email.trim(), password);
      await queryClient.resetQueries();
      router.replace("/");
    } catch (caught) {
      const code = errorCodeOf(caught);
      setError(code === "UNAUTHENTICATED" ? t("auth.invalidCredentials") : t(`error.${code}`));
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <header>
        <p className="text-sm text-text-muted">{t("app.name")}</p>
        <h1 className="text-2xl font-semibold">{t("auth.signInTitle")}</h1>
      </header>
      {service ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field id={emailId} label={t("auth.email")}>
            <input
              id={emailId}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id={passwordId} label={t("auth.password")} error={error}>
            <PasswordInput
              id={passwordId}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy || !email || !password}>
            {busy ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </form>
      ) : (
        <ButtonLink href="/" variant="primary">
          {t("state.backToCompanies")}
        </ButtonLink>
      )}
    </main>
  );
}
