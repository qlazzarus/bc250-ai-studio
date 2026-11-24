/**
 * UCP02: display state, deliberately separate from request state.
 *
 * Width, orientation and panel collapse change *where* things are drawn, never *what*
 * was asked. They live in their own object so that no code path can accidentally feed
 * them into a revision: `composeRevisions` takes a `ComposeEdit` and this is not one.
 *
 * A rotation re-lays out the screen; it must not clear the brief, drop chips, discard
 * candidates, or trigger a request. Keeping the two apart in the type system is what
 * makes that checkable instead of a code-review promise.
 */

export type ComposeView = {
  /** Dictionary panel open/closed. Also a user preference worth remembering per session. */
  panelOpen: boolean;
  /** Collapsed scene groups, by group key. Purely visual. */
  collapsedGroups: string[];
  /** Coarse width class, not a pixel count: a resize within a class is not a state change. */
  width: "narrow" | "wide";
  orientation: "portrait" | "landscape";
};

export const INITIAL_VIEW: ComposeView = {
  panelOpen: true,
  collapsedGroups: [],
  width: "wide",
  orientation: "landscape",
};

/** 360 px is the narrow reference from §3; the class boundary sits above it. */
export const NARROW_MAX_WIDTH = 640;

export const widthClass = (pixels: number): ComposeView["width"] =>
  (pixels <= NARROW_MAX_WIDTH ? "narrow" : "wide");

export function setWidth(view: ComposeView, pixels: number): ComposeView {
  const width = widthClass(pixels);
  return width === view.width ? view : { ...view, width };
}

export function rotate(view: ComposeView, orientation: ComposeView["orientation"]): ComposeView {
  return orientation === view.orientation ? view : { ...view, orientation };
}

export function togglePanel(view: ComposeView): ComposeView {
  return { ...view, panelOpen: !view.panelOpen };
}

/**
 * Collapse/expand one group.
 *
 * The *collapsed* set is stored rather than the expanded one, so a group the user has
 * never touched is expanded by default: a group introduced by a later dictionary version
 * must not start hidden just because it is missing from a saved list.
 */
export function toggleGroup(view: ComposeView, group: string): ComposeView {
  const collapsed = view.collapsedGroups.includes(group)
    ? view.collapsedGroups.filter((item) => item !== group)
    : [...view.collapsedGroups, group];
  return { ...view, collapsedGroups: collapsed };
}

export const isCollapsed = (view: ComposeView, group: string): boolean =>
  view.collapsedGroups.includes(group);

/**
 * Resize/rotate may also flip the width class, which is the one case where a display
 * event changes two fields. Grouped here so the caller does not forget the second one.
 */
export function resize(view: ComposeView, input: { pixels: number; orientation: ComposeView["orientation"] }): ComposeView {
  return rotate(setWidth(view, input.pixels), input.orientation);
}

// ── UIX03: candidate expansion and the folded strip ─────────────────────────────
//
// Both are *view* state in the sense this module already means: they change where things are
// drawn and what is said about them, never what was asked. `composeRevisions` takes a
// `ComposeEdit`, and none of the types below is one — which is what makes "toggling a card
// cannot bump a revision" checkable in the type system rather than a review promise.

/** Which candidate bodies are open, and for which reply. */
export type CandidateView = { key: string; expanded: string[]; collapsed: string[] };

/** The strip's phase, as a word CSS can select on. */
export type StripPhase = "pending" | "ready" | "stale" | "failed" | "cancelled" | "clarify";

/**
 * The four facts the folded strip needs. Deliberately flat and serializable.
 *
 * This is what `ComposePanel` *publishes*, not what it computes: the panel owns the session
 * and derives it from the same `visible` it renders, so the strip cannot describe a phase the
 * panel is not in.
 */
export type ComposeStatusView = {
  phase: "idle" | "pending" | "ready" | "needs_clarification" | "failed" | "cancelled";
  /** Usable candidates in the current draft; 0 unless the phase carries a reply. */
  candidateCount: number;
  /** The displayed reply no longer matches the edit (brief/chips/model moved). */
  stale: boolean;
  /** The headline of the failure alert, when the phase is `failed`. */
  failureKo: string | null;
};

/** A view with no decisions recorded yet, for one reply. */
export const EMPTY_VIEW = (key = ""): CandidateView =>
  ({ key, expanded: [], collapsed: [] });

/**
 * The expansion lists that apply to the reply identified by `key`.
 *
 * A mismatched key means "this is a different reply", so the stored expansion is ignored
 * wholesale and the defaults apply. Deriving it here — instead of clearing it in an effect —
 * means the first render of a new reply already shows the right card, so no frame ever pairs
 * the new candidate ids with the previous reply's open set. Two replies may even share a
 * candidate id, which is why the key is the reply and not the id set.
 */
export function expansionFor(view: CandidateView, key: string): CandidateView {
  return view.key === key ? view : EMPTY_VIEW(key);
}

/**
 * Whether one candidate's body is open.
 *
 * The first body is open unless the user closed it; the rest open only on request. `collapsed`
 * exists so closing the default-open first card is a remembered decision rather than
 * indistinguishable from "not touched yet" — without it the card would spring back open.
 */
export function candidateBodyOpen(
  view: CandidateView, candidateId: string, index: number,
): boolean {
  return index === 0
    ? !view.collapsed.includes(candidateId)
    : view.expanded.includes(candidateId);
}

/** The next view after one toggle, so the component only has to store the result. */
export function toggledView(
  view: CandidateView, candidateId: string, index: number,
): CandidateView {
  const list = index === 0 ? view.collapsed : view.expanded;
  const next = list.includes(candidateId)
    ? list.filter((id) => id !== candidateId) : [...list, candidateId];
  return index === 0 ? { ...view, collapsed: next } : { ...view, expanded: next };
}

/**
 * The one line the folded strip shows, derived from the panel's own report.
 *
 * This is a *rendering* of `ComposeStatusView`, not a second guess at the session: every
 * branch reads a fact the panel published, and none of them decides whether an apply is
 * allowed — `planApply` owns that.
 *
 * Staleness outranks the phase because it is what makes a ready draft *not usable*: a strip
 * saying "후보 3개 준비됨" over an invalidated reply would promise something the apply button
 * will refuse. An idle session has nothing to say, so it renders nothing at all.
 */
export function composeStripView(
  status: ComposeStatusView | null,
): { phase: StripPhase; text: string } | null {
  if (!status) return null;
  const count = status.candidateCount;
  if (status.stale && count > 0) {
    return { phase: "stale",
      text: `한글 장면이 바뀌었습니다. 후보 ${count}개는 다시 만들어야 적용할 수 있습니다.` };
  }
  switch (status.phase) {
    case "pending":
      return { phase: "pending", text: "한글 장면으로 후보를 만드는 중입니다." };
    case "ready":
      return count > 0
        ? { phase: "ready", text: `후보 ${count}개가 준비되었습니다. 적용은 한글 장면에서 고르세요.` }
        : { phase: "ready", text: "후보가 비어 있습니다. 다시 만들어 보세요." };
    case "needs_clarification":
      return { phase: "clarify", text: "확인이 필요한 질문이 있습니다. 답하면 후보를 만듭니다." };
    case "failed":
      return { phase: "failed",
        text: `구성에 실패했습니다${status.failureKo ? `: ${status.failureKo}` : ""}.` };
    case "cancelled":
      return { phase: "cancelled", text: "구성을 취소했습니다. 입력과 선택은 그대로 남아 있습니다." };
    default:
      return null;
  }
}
