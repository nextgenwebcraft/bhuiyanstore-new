"use client";

import { MIN_PASSWORD_LENGTH } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { useSession } from "@/data/http/http-provider";
import { errorCodeOf, ServiceError } from "@/data/ports/service-error";

type Errors = { currentPassword?: string; newPassword?: string; form?: string };

function errorsFrom(caught: unknown): Errors {
  if (caught instanceof ServiceError && caught.code === "VALIDATION_FAILED") {
    const fields = new Set(caught.fieldErrors.map((f) => f.path));
    if (fields.has("currentPassword")) return { currentPassword: t("auth.passwordIncorrect") };
    if (caught.fieldErrors.some((f) => f.code === "validation.password.unchanged")) {
      return { newPassword: t("auth.passwordUnchanged") };
    }
    if (fields.has("newPassword")) return { newPassword: t("auth.passwordTooShort") };
  }
  return { form: t(`error.${errorCodeOf(caught)}`) };
}

export function ChangePasswordPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const currentId = useId();
  const nextId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || busy) return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setErrors({ newPassword: t("auth.passwordTooShort") });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await session.service.changePassword({ currentPassword, newPassword });
      await queryClient.resetQueries();
      router.replace("/");
    } catch (caught) {
      setErrors(errorsFrom(caught));
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <header>
        <p className="text-sm text-text-muted">{t("app.name")}</p>
        <h1 className="text-2xl font-semibold">{t("auth.changePasswordTitle")}</h1>
        {session?.me.mustChangePassword ? (
          <p className="mt-1 text-text-muted">{t("auth.changePasswordHint")}</p>
        ) : null}
      </header>
      {session ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field id={currentId} label={t("auth.currentPassword")} error={errors.currentPassword}>
            <input
              id={currentId}
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id={nextId} label={t("auth.newPassword")} error={errors.newPassword}>
            <input
              id={nextId}
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClass}
            />
          </Field>
          {errors.form ? (
            <p className="text-sm text-error" role="alert">
              {errors.form}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !currentPassword || !newPassword}
          >
            {busy ? t("auth.changingPassword") : t("auth.changePassword")}
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
