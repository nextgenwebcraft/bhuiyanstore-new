"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { normalizeDigits, t } from "@bsd/i18n";
import { useRouter } from "next/navigation";
import { forwardRef, useEffect, useImperativeHandle, useId, useRef, useState } from "react";
import { Icon, sectionIcon } from "@/components/icons";
import { useActiveDraftGuard } from "./draft-guard";
import { companyHref, visibleFlow, type FlowLink } from "./navigation";
import { ShortcutHint } from "./side-nav";

export type QuickJumpHandle = { open: () => void };

type Target = FlowLink & { group: string };

/**
 * Keyboard layer of the shell: Ctrl+K (or "/") opens a screen search, Alt+1…9 opens the daily
 * screens in work order. Both stay inactive while a form with unsaved input or another dialog is
 * open, so a shortcut never drops a draft.
 */
export const QuickJump = forwardRef<QuickJumpHandle, { workspace: CompanyWorkspace }>(
  function QuickJump({ workspace }, ref) {
    const router = useRouter();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listId = useId();
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const getActiveDraftGuard = useActiveDraftGuard();
    const companyId = workspace.company.id;

    const targets: Target[] = [
      {
        path: "",
        labelKey: "nav.dashboard",
        sectionId: "dashboard",
        shortcut: undefined,
        group: "",
      },
      ...visibleFlow(workspace).flatMap((g) =>
        g.links.map((link) => ({ ...link, group: t(g.labelKey) })),
      ),
    ];
    const needle = normalizeDigits(query).trim().toLowerCase();
    const results = needle
      ? targets.filter(
          (target) =>
            t(target.labelKey).toLowerCase().includes(needle) ||
            target.path.includes(needle) ||
            target.group.toLowerCase().includes(needle),
        )
      : targets;
    const active = Math.min(index, Math.max(results.length - 1, 0));

    const open = () => {
      setQuery("");
      setIndex(0);
      dialogRef.current?.showModal();
      inputRef.current?.focus();
    };
    const go = (path: string) => {
      dialogRef.current?.close();
      router.push(companyHref(companyId, path));
    };
    useImperativeHandle(ref, () => ({ open }));

    const shortcutPaths = new Map(
      targets.filter((x) => x.shortcut).map((x) => [x.shortcut as number, x.path]),
    );
    const busy = () =>
      getActiveDraftGuard() !== null ||
      [...document.querySelectorAll("dialog[open]")].some((d) => d !== dialogRef.current);

    const handlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === "KeyK") {
        if (busy()) return;
        event.preventDefault();
        open();
        return;
      }
      if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (busy()) return;
        event.preventDefault();
        open();
        return;
      }
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (digit && event.altKey && !event.ctrlKey && !event.metaKey) {
        const path = shortcutPaths.get(Number(digit));
        if (path === undefined || busy()) return;
        event.preventDefault();
        router.push(companyHref(companyId, path));
      }
    };
    useEffect(() => {
      handlerRef.current = onKey;
    });
    useEffect(() => {
      const listener = (event: KeyboardEvent) => handlerRef.current(event);
      window.addEventListener("keydown", listener);
      return () => window.removeEventListener("keydown", listener);
    }, []);

    return (
      <dialog
        ref={dialogRef}
        aria-label={t("nav.jump.open")}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="mx-auto mt-[12vh] w-[min(36rem,92vw)] rounded-2xl border border-border bg-surface p-0 text-text shadow-raised"
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Icon name="search" className="size-4 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label={t("nav.jump.open")}
            placeholder={t("nav.jump.placeholder")}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex(Math.min(active + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex(Math.max(active - 1, 0));
              } else if (event.key === "Enter" && results[active]) {
                event.preventDefault();
                go(results[active].path);
              }
            }}
            className="min-h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-subtle"
          />
        </div>
        <ul id={listId} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-text-muted">{t("nav.jump.empty")}</li>
          ) : (
            results.map((target, i) => (
              <li
                key={target.path || "dashboard"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(target.path)}
                className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm ${
                  i === active ? "bg-brand/10 text-text" : "text-text-muted"
                }`}
              >
                <Icon name={sectionIcon(target.sectionId)} className="size-4" />
                <span className="truncate font-medium text-text">{t(target.labelKey)}</span>
                {target.group ? (
                  <span className="truncate text-xs text-text-muted">{target.group}</span>
                ) : null}
                {target.shortcut ? <ShortcutHint n={target.shortcut} /> : null}
              </li>
            ))
          )}
        </ul>
        <p className="border-t border-border px-4 py-2 text-xs text-text-muted">
          {t("nav.jump.hint")}
        </p>
      </dialog>
    );
  },
);
