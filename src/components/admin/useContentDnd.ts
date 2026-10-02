"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useContentDnd — pointer-based drag reorder for admin content lists.
 * Mouse + touch (no dependencies): the drag handle is the only
 * `touch-none` zone so the rest of the page keeps scrolling on mobile.
 * Live-reorders via onPreview while dragging; fires onCommit on drop.
 */

export type DndHandleProps = {
  onPointerDown: (event: React.PointerEvent<HTMLElement>, index: number) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
};

export function useContentDnd<T>(options: {
  items: T[];
  keyOf: (item: T) => string;
  disabled?: boolean;
  /** Live preview while dragging (usually parent setState). */
  onPreview: (next: T[]) => void;
  /** Final array on drop (usually persist to the server). */
  onCommit: (next: T[]) => void;
}): {
  listRef: React.RefObject<HTMLUListElement | null>;
  rowRef: (key: string) => (node: HTMLLIElement | null) => void;
  dragIndex: number | null;
  handleProps: (index: number) => DndHandleProps;
} {
  const { items, keyOf, disabled, onPreview, onCommit } = options;
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const latestRef = useRef({ items, keyOf, disabled, onPreview, onCommit });
  latestRef.current = { items, keyOf, disabled, onPreview, onCommit };

  const dragRef = useRef<{
    key: string;
    pointerId: number;
    startY: number;
    startTop: number;
    dy: number;
  } | null>(null);

  // Keep the dragged row glued to the pointer while siblings animate.
  // Runs every render on purpose (positions are read from the live DOM).
   
  useEffect(() => {
    if (dragIndex === null || !dragRef.current) return;
    const row = rowRefs.current.get(dragRef.current.key);
    if (!row) return;
    const targetTop = dragRef.current.startTop + dragRef.current.dy;
    row.style.transform = `translateY(${targetTop - row.offsetTop}px)`;
  });

  function clearDragStyles() {
    for (const row of rowRefs.current.values()) row.style.transform = "";
  }

  function rowRef(key: string) {
    return (node: HTMLLIElement | null) => {
      if (node) rowRefs.current.set(key, node);
      else rowRefs.current.delete(key);
    };
  }

  function onHandlePointerDown(
    event: React.PointerEvent<HTMLElement>,
    index: number,
  ) {
    const latest = latestRef.current;
    if (latest.disabled || latest.items.length < 2) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture unsupported — moves still fire while over the handle.
    }
    const list = listRef.current;
    const row = list?.children[index] as HTMLElement | undefined;
    dragRef.current = {
      key: latest.keyOf(latest.items[index]!),
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: row ? row.offsetTop : 0,
      dy: 0,
    };
    setDragIndex(index);
  }

  function onHandlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || !list || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const latest = latestRef.current;
    drag.dy = event.clientY - drag.startY;
    const rows = Array.from(list.children) as HTMLElement[];
    if (rows.length === 0) return;
    const pointerTop = drag.startTop + drag.dy;
    let target = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const middle = rows[i]!.offsetTop + rows[i]!.offsetHeight / 2;
      if (pointerTop < middle) {
        target = i;
        break;
      }
    }
    target = Math.max(0, Math.min(rows.length - 1, target));
    const current = latest.items;
    const from = current.findIndex((item) => latest.keyOf(item) === drag.key);
    if (from < 0 || from === target) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved!);
    latest.onPreview(next);
    setDragIndex(target);
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragIndex(null);
    clearDragStyles();
    latestRef.current.onCommit(latestRef.current.items);
  }

  return {
    listRef,
    rowRef,
    dragIndex,
    handleProps: (index: number) => ({
      onPointerDown: (event) => onHandlePointerDown(event, index),
      onPointerMove: onHandlePointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    }),
  };
}
