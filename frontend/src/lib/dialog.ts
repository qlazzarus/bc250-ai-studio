import { useEffect, useRef } from "react";

/**
 * UIX06: the two gallery dialogs (`ImageViewer`, `MetadataModal`) had `role="dialog"
 * aria-modal="true"` but no focus management at all: nothing took focus on open, Tab walked
 * straight out into the page behind, and closing dropped focus to `<body>`. This module holds
 * the parts that can be reasoned about without a DOM (index arithmetic, the label, which
 * elements count as focusable) so they can be unit-tested, plus one hook that wires them to
 * `document` for the two dialogs that need them.
 *
 * Deliberately not a library: the requirement is a trap, an initial focus and an Escape key,
 * which is the whole of what follows.
 */

/** Elements a tab press can land on, in DOM order. `[tabindex="-1"]` is programmatic-only. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Which element the next Tab lands on. Pure, because the wrap-around is the part that is easy
 * to get wrong and the part a test can pin exactly:
 *
 * - from the last element, Tab wraps to the first; from the first, Shift+Tab wraps to the last;
 * - `current < 0` means focus is not inside the dialog (or on a non-focusable node), so the
 *   first Tab has to *enter* it — at the start going forward, at the end going backward, which
 *   is what makes Shift+Tab from outside feel like coming in the back door;
 * - an empty dialog yields `-1`, and the caller focuses the container instead.
 */
export function nextFocusIndex(current: number, total: number, shift: boolean): number {
  if (total <= 0) return -1;
  if (current < 0) return shift ? total - 1 : 0;
  return shift ? (current - 1 + total) % total : (current + 1) % total;
}

/**
 * The accessible name of a dialog. It carries the image id because two dialogs that both
 * announce "이미지 보기" are indistinguishable to a screen-reader user moving between them —
 * and because the id is the only thing that says *which* image is open.
 */

/** A zero-size element cannot receive focus, so it must not be counted as a tab stop. */
function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false;
  return element.getClientRects().length > 0;
}

/** Every tab stop inside `root`, in the order Tab visits them. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible);
}


/**
 * Only the topmost dialog reacts to Escape and traps Tab. The two gallery dialogs are siblings
 * today, but a nested dialog would otherwise have both parents fighting over the same key
 * press. The stack is module-level so the ordering spans component trees.
 */
const stack: symbol[] = [];

type DialogOptions = {
  /** Called for Escape. The caller decides what "close" means for its own dialog. */
  onClose(): void;
  /** What to focus on open. Defaults to the first tab stop, then the container itself. */
  initialFocus?: () => HTMLElement | null;
  active?: boolean;
};

/**
 * Wires Tab-cycling, initial focus and Escape for one dialog. Focus *return* is intentionally
 * not handled here: where focus goes on close depends on why it closed (opener, final prompt,
 * gallery heading), so the caller owns that decision and this hook only stops the dialog from
 * trapping the user.
 */
export function useDialogTrap<T extends HTMLElement>({ onClose, initialFocus, active = true }: DialogOptions) {
  const ref = useRef<T | null>(null);
  const token = useRef(Symbol("dialog"));
  // Held in refs so the effect below does not re-run (and re-focus) on every parent render:
  // `onClose` is a fresh closure each render, and re-running would steal focus back mid-dialog.
  const closeRef = useRef(onClose);
  const initialRef = useRef(initialFocus);
  // Synced in an effect rather than during render: writing a ref while rendering is what the
  // `react-hooks/refs` rule forbids, and an effect after every commit is the supported place.
  useEffect(() => {
    closeRef.current = onClose;
    initialRef.current = initialFocus;
  });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const id = token.current;
    stack.push(id);
    // The first tab stop is the close button in both dialogs, which is the right place to start:
    // it is the one action that is always available, and it puts the dialog's exit under the
    // first Tab rather than behind a scroll.
    const first = initialRef.current?.() ?? tabbables(node)[0] ?? node;
    if (!node.contains(document.activeElement)) first.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = tabbables(node);
      if (!stops.length) { event.preventDefault(); node.focus(); return; }
      const current = stops.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(current, stops.length, event.shiftKey);
      // Prevent the default on *every* Tab while the dialog is open, not only on the wrap: a
      // default Tab from the last stop would move to browser chrome, and the refocus after it
      // would fight the browser. Taking it over entirely keeps focus inside by construction.
      event.preventDefault();
      stops[next]?.focus();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const at = stack.lastIndexOf(id);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [active]);

  return ref;
}

/**
 * Where focus goes when a dialog closes. Kept as data rather than a function so the contract is
 * readable and testable: each cause of closing has exactly one destination, and none of them is
 * "whatever had focus last" (which after a removed card is `<body>`).
 */
export type ReturnTarget =
  /** Plain close or Escape: the control that opened it. */
  | { to: "opener" }
  /** A successful reuse: the final prompt, because that is what was just rewritten. */
  | { to: "final-prompt" }
  /** The card that opened it is gone (archived away): the gallery heading. */
  | { to: "gallery-heading" };

/** Order of preference when a target is missing from the DOM. Never `<body>`. */
export const FALLBACK_ORDER = ["final-prompt", "gallery-heading"] as const;

/**
 * Resolves a return target to an element, falling back safely. `opener` is special: it may be a
 * detached node after a refresh, and a detached node cannot take focus, so it degrades to the
 * same fallback chain instead of silently doing nothing.
 */
export function resolveReturn(
  target: ReturnTarget,
  lookup: {
    opener: () => HTMLElement | null;
    finalPrompt: () => HTMLElement | null;
    galleryHeading: () => HTMLElement | null;
  },
): HTMLElement | null {
  const named = (name: string): HTMLElement | null =>
    name === "final-prompt" ? lookup.finalPrompt() : lookup.galleryHeading();
  if (target.to === "opener") {
    const opener = lookup.opener();
    // `isConnected` is the test for "still in the document": a card removed by a refresh keeps
    // its node alive in the closure but is no longer focusable.
    if (opener && opener.isConnected) return opener;
    for (const name of FALLBACK_ORDER) {
      const found = named(name);
      if (found) return found;
    }
    return null;
  }
  const direct = named(target.to);
  if (direct) return direct;
  for (const name of FALLBACK_ORDER) {
    if (name === target.to) continue;
    const found = named(name);
    if (found) return found;
  }
  return null;
}

export function dialogLabel(kind: string, id: string): string {
  const short = id ? id.slice(0, 8) : "";
  return short ? `${kind} · ${short}` : kind;
}
