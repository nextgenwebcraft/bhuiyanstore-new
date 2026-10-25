"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { inputClass } from "./field";
import { Icon } from "./icons";
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
  clearLabel,
  disabled = false,
  invalid = false,
  onEnterWithoutChoice,
  onBlur,
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
  /** Shown as a clear control when the field has text. */
  clearLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Enter pressed with nothing highlighted (e.g. submit the form). */
  onEnterWithoutChoice?: () => void;
  /** After the field loses focus. The list has already closed. */
  onBlur?: () => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });
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

  function computePosition() {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropdownRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }

  useEffect(() => {
    if (!open) return;
    const update = () => computePosition();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
    // open is the only relevant trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function show(next: string) {
    computePosition();
    setOpen(true);
    setActive(initialActive(buildItems(options, next, createLabel !== undefined), next));
  }

  function clear() {
    onTextChange("");
    setOpen(false);
    setActive(-1);
    document.getElementById(id)?.focus();
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

  const dropdown = (
    <ul
      id={listId}
      ref={listRef}
      role="listbox"
      aria-label={listLabel}
      hidden={!open}
      onMouseDown={(event) => event.preventDefault()}
      style={{
        position: "fixed",
        top: dropdownRect.top,
        left: dropdownRect.left,
        minWidth: dropdownRect.width,
        zIndex: 9999,
      }}
      className="max-h-64 w-max max-w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-raised"
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
              <span className="block font-semibold break-words">{option.label}</span>
              {option.secondary ? (
                <span className="block text-xs break-words whitespace-normal text-text-muted">
                  {option.secondary}
                </span>
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
  );

  return (
    <div className="relative">
      <input
        ref={inputRef}
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
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
        className={clearLabel && text ? `${inputClass} pr-16` : inputClass}
      />
      {clearLabel && text && !disabled ? (
        <button
          type="button"
          aria-label={clearLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
          className="absolute inset-y-0 right-1 flex items-center gap-1 rounded-md px-2 text-xs font-medium text-text-muted hover:text-text"
        >
          <Icon name="close" className="size-3.5" />
          {clearLabel}
        </button>
      ) : null}
      {open && typeof document !== "undefined"
        ? createPortal(dropdown, document.body)
        : null}
    </div>
  );
}
