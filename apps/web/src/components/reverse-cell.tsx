import { t } from "@bsd/i18n";
import { Button } from "@/components/button";
import { tdClass } from "@/components/data-table";

/** The last table cell of a posted entry: a reverse button for actors who may undo it. */
export function ReverseCell({
  canReverse,
  posted,
  pending,
  onReverse,
}: {
  canReverse: boolean;
  posted: boolean;
  pending: boolean;
  onReverse: () => void;
}) {
  return (
    <td className={`${tdClass} text-right`}>
      {canReverse && posted ? (
        <Button disabled={pending} onClick={onReverse}>
          {t("common.reverse")}
        </Button>
      ) : null}
    </td>
  );
}
