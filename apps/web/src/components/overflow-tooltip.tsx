"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

type Position = { top: number; left: number };

/** `scrollWidth`/`clientWidth` are whole pixels; an ellipsis also appears for a sub-pixel overflow. */
function isTruncated(el: HTMLElement) {
  if (el.scrollWidth > el.clientWidth) return true;
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width - el.getBoundingClientRect().width > 0.01;
}

/**
 * For a row holding truncated single-line text: spread `rowProps` on the row, put `textRef` on the
 * text and render `tooltip`. Hovering or focusing the row shows the full text beside it, only when
 * the text is actually cut off.
 */
export function useOverflowTooltip<Row extends HTMLElement>(text: string) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  function show(event: { currentTarget: Row }) {
    const el = textRef.current;
    if (!el || !isTruncated(el)) return;
    const row = event.currentTarget.getBoundingClientRect();
    setPosition({ top: row.top + row.height / 2, left: row.right + 8 });
  }
  const hide = () => setPosition(null);

  const tooltip = position
    ? createPortal(
        <span
          role="tooltip"
          style={{ top: position.top, left: position.left }}
          className="pointer-events-none fixed z-50 max-w-72 -translate-y-1/2 animate-fade-in rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] font-medium text-text shadow-raised"
        >
          {text}
        </span>,
        document.body,
      )
    : null;

  return {
    textRef,
    tooltip,
    rowProps: { onPointerEnter: show, onPointerLeave: hide, onFocus: show, onBlur: hide },
  };
}
