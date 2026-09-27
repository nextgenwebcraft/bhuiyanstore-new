import { t } from "@bsd/i18n";
import { ButtonLink } from "@/components/button";
import { StatePanel } from "@/components/state-panel";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8">
      <StatePanel
        title={t("state.notFoundTitle")}
        action={<ButtonLink href="/">{t("state.backToCompanies")}</ButtonLink>}
      />
    </main>
  );
}
