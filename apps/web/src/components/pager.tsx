import { t, toBengaliDigits } from "@bsd/i18n";
import { Button } from "./button";

/** Previous / next for a list cut into pages; `page` is 1-based. Hidden for a single page. */
export function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("pager.label")} className="flex items-center justify-end gap-2 text-sm">
      <Button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← {t("pager.previous")}
      </Button>
      <span className="text-text-muted tabular-nums">
        {toBengaliDigits(String(page))} / {toBengaliDigits(String(pages))}
      </span>
      <Button disabled={page >= pages} onClick={() => onChange(page + 1)}>
        {t("pager.next")} →
      </Button>
    </nav>
  );
}
