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
