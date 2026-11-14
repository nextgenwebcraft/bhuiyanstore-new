"use client";

import { useEffect, useRef } from "react";

/** Elements that keep their own mouse behaviour inside a draggable table. */
const INTERACTIVE = "input, select, textarea, button, a, label, summary, [role='button']";
const DRAG_THRESHOLD = 4;

/**
 * Scroll container for wide or long tables: no taller than three quarters of the screen, with a
 * sticky header, and pannable by dragging anywhere that isn't a control (mouse only; touch
 * already pans).
 */
export function TableScroller({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number; left: number; top: number } | null = null;
    let dragged = false;

    const markScrollable = () => {
      const scrollable = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
      if (scrollable) el.dataset.scrollable = "";
      else delete el.dataset.scrollable;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      if (!("scrollable" in el.dataset)) return;
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
      start = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
      dragged = false;
    };
    const move = (event: PointerEvent) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!dragged) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        dragged = true;
        el.dataset.dragging = "";
        el.setPointerCapture(event.pointerId);
      }
      el.scrollLeft = start.left - dx;
      el.scrollTop = start.top - dy;
    };
    const up = (event: PointerEvent) => {
      if (!start) return;
      start = null;
      delete el.dataset.dragging;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    };
    const click = (event: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const observer = new ResizeObserver(markScrollable);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    markScrollable();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    return () => {
      observer.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`scrollbar-thin max-h-[75vh] overflow-auto overscroll-x-contain rounded-xl border border-border bg-surface shadow-card data-[dragging]:cursor-grabbing data-[dragging]:select-none data-[scrollable]:cursor-grab [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 ${className}`}
    >
      {children}
    </div>
  );
}
