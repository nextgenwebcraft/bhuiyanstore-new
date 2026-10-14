"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { inputClass } from "./field";
import {
  buildItems,
  initialActive,
  moveActive,
  type ComboboxItem,
  type ComboboxOption,
} from "./combobox-logic";

export type { ComboboxOption } from "./combobox-logic";

/** What the user picked: a listed option, or the "create" row for the typed name. */
export type ComboboxChoice =
  { kind: "option"; option: ComboboxOption } | { kind: "create"; text: string };

/**
 * Accessible single-select combobox with a filtered listbox (WAI-ARIA 1.2 editable combobox with
 * list autocomplete). The caller owns the text and the selected id: typing calls `onTextChange`
 * (and the caller clears its selection), picking calls `onChoose`.
 *
 * Keys: Down/Up open and move (wrapping), Home/End jump, Enter picks the highlighted row,
 * Escape closes the list. The list opens with the exact match highlighted, otherwise with no row,
 * so Enter never picks a near match while someone types a new name.
 *
 * Search is digit- and case-insensitive (`@bsd/i18n`). Pass `createLabel` to add the last "create"
 * row, shown only when no option matches the typed text exactly. Uses design tokens only and fits
 * a 360px screen (the list is as wide as the input and scrolls).
 */
export function Combobox({
  id,
  text,
  onTextChange,
  options,
  selectedId = null,
  onChoose,
  createLabel,
  placeholder,
  emptyLabel,
  listLabel,
  disabled = false,
  invalid = false,
  onEnterWithoutChoice,
}: {
  id: string;
  text: string;
  onTextChange: (text: string) => void;
  options: readonly ComboboxOption[];
  selectedId?: string | null;
  onChoose: (choice: ComboboxChoice) => void;
  /** Text of the create row for the typed name; omit to disable creating. */
  createLabel?: (text: string) => string;
  placeholder?: string;
  /** Shown when the list has no row at all. */
  emptyLabel: string;
  /** Accessible name of the listbox. */
  listLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Enter pressed with nothing highlighted (e.g. submit the form). */
  onEnterWithoutChoice?: () => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useMemo(
    () => buildItems(options, text, createLabel !== undefined),
    [options, text, createLabel],
  );
  const optionId = (index: number) => `${id}-opt-${index}`;

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from id; the highlighted row is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  function show(next: string) {
    setOpen(true);
    setActive(initialActive(buildItems(options, next, createLabel !== undefined), next));
  }

  function choose(item: ComboboxItem) {
    setOpen(false);
    setActive(-1);
    onChoose(item.kind === "option" ? { kind: "option", option: item.option } : item);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (!open) {
          show(text);
          if (items.length > 0) setActive(moveActive(-1, delta, items.length));
          return;
        }
        setActive(moveActive(active, delta, items.length));
        return;
      }
      case "Home":
      case "End":
        if (open && items.length > 0) {
          event.preventDefault();
          setActive(event.key === "Home" ? 0 : items.length - 1);
        }
        return;
      case "Enter": {
        const item = open ? items[active] : undefined;
        if (item) {
          event.preventDefault();
          choose(item);
        } else {
          setOpen(false);
          onEnterWithoutChoice?.();
        }
        return;
      }
      case "Escape":
        if (open) {
          // Close the list only; a surrounding dialog must stay open.
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          onTextChange(event.target.value);
          show(event.target.value);
        }}
        onFocus={() => show(text)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={inputClass}
      />
      <ul
        id={listId}
        ref={listRef}
        role="listbox"
        aria-label={listLabel}
        hidden={!open}
        // Keep focus in the input while the pointer picks a row.
        onMouseDown={(event) => event.preventDefault()}
        className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-raised"
      >
        {items.length === 0 ? (
          <li role="presentation" className="px-3 py-2 text-sm text-text-muted">
            {emptyLabel}
          </li>
        ) : null}
        {items.map((item, index) => {
          const isActive = index === active;
          const base = `flex min-h-(--touch-target) cursor-pointer items-center justify-between gap-3 px-3 py-1.5 ${
            isActive ? "bg-surface-hover" : ""
          }`;
          if (item.kind === "create") {
            return (
              <li
                key="create"
                id={optionId(index)}
                role="option"
                aria-selected={false}
                onClick={() => choose(item)}
                className={`${base} border-t border-border font-semibold text-text`}
              >
                {createLabel?.(item.text)}
              </li>
            );
          }
          const { option } = item;
          return (
            <li
              key={option.id}
              id={optionId(index)}
              role="option"
              aria-selected={option.id === selectedId}
              onClick={() => choose(item)}
              className={base}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{option.label}</span>
                {option.secondary ? (
                  <span className="block truncate text-xs text-text-muted">{option.secondary}</span>
                ) : null}
              </span>
              {option.trailing ? (
                <span
                  className={`shrink-0 text-sm font-medium tabular-nums ${
                    option.tone === "danger" ? "text-error" : "text-text-muted"
                  }`}
                >
                  {option.trailing}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
