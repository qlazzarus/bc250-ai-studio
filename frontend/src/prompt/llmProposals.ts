import type { SceneSpecification } from "./scene";
import { sha256Hex } from "./digest.ts";

/**
 * LLM proposal request lifecycle (LLM-I04).
 *
 * Pure module: no React, no fetch, no timers. The transport (`runProposal`) takes
 * the sender as an argument so tests drive it with a fake and the component owns
 * the `AbortController`.
 *
 * Two independent guards stop a late reply from reaching the screen:
 *
 * 1. `state.requestId` - only the newest request may settle. Starting another
 *    request replaces the id, so an older reply finds a different id and is dropped.
 * 2. `revisions` - the server echoes the fingerprint it was asked about. If the
 *    user edited the text, swapped the model or changed the selection while the
 *    call was in flight, the current fingerprint no longer matches and the reply is
 *    discarded even though it answered *its own* request correctly.
 *
 * Neither guard mutates the scene: a proposal can never edit the user's text.
 */

export type ProposalRevisions = { scene: string; selection: string; text: string };

export type ProposalSuggestion = {
  id: string;
  matched_phrase: string;
  basis: "quote" | "inferred";
  polarity: "affirmed" | "negated";
  actor: string | null;
  confidence: number;
  reason_ko: string;
};

export type ProposalSpan = { text: string; why: string; polarity: string };
export type ProposalAmbiguity = { text: string; why: string; candidates: string[] };
export type ProposalProvider = { model: string; version: string; latency_ms: number; finish_reason: string };

/**
 * VAR01: one situation candidate. It is a Korean sentence plus the place/action IDs
 * it would swap — not a dictionary suggestion and not a stored scene. Selecting a
 * card is VAR02; nothing here is applied automatically.
 */
export type ProposalVariant = {
  variant_id: string;
  label_ko: string;
  prompt_ko: string;
  changed_ids: string[];
  removed_ids: string[];
  unresolved_ko: string[];
};

/** The server reply in the C01-3 shape. Failure envelopes omit some fields. */
export type ProposalReply = {
  proposal_id: string | null;
  /** Absent on 200 failure envelopes, so it is only used as a second check. */
  request_id: string | null;
  status: "ready" | "empty" | "unavailable" | "unsupported_v1";
  kind: string | null;
  provider: ProposalProvider | null;
  revisions: ProposalRevisions | null;
  suggestions: ProposalSuggestion[];
  /** VAR01: only `situation_variants` replies carry candidates; empty otherwise. */
  variants: ProposalVariant[];
  unresolved_spans: ProposalSpan[];
  ambiguities: ProposalAmbiguity[];
  rejected: Record<string, unknown>[];
  truncated: boolean;
  why: string | null;
  message: string | null;
  detail: string | null;
};

export type ProposalPhase = "idle" | "loading" | "ready" | "empty" | "unavailable" | "error" | "cancelled";

/** `stale_revision` = the user's state changed while the call was in flight. */
export type CancelReason = "user" | "stale_revision";

export type ProposalState =
  | { phase: "idle" }
  /** `kind`/`scope` are the request's own; a reply is only adopted when its echoed
   * kind matches, so a `selection_hint` answer can never be read as a partial change. */
  | { phase: "loading"; requestId: string; revisions: ProposalRevisions; kind: ProposalKind; scope: ProposalScopeInput | null }
  /** Every settled state keeps the revisions it was computed for (LLM-I05 cards). */
  /**
   * `acceptedIds` records which cards the user already took. It is what lets the
   * status line stop saying "아직 선택에 반영하지 않았습니다" the moment that is false.
   */
  | { phase: "ready"; reply: ProposalReply; revisions: ProposalRevisions; acceptedIds: string[]; kind: ProposalKind; scope: ProposalScopeInput | null }
  | { phase: "empty"; reply: ProposalReply; revisions: ProposalRevisions; acceptedIds: string[]; kind: ProposalKind; scope: ProposalScopeInput | null }
  | { phase: "unavailable"; reply: ProposalReply; revisions: ProposalRevisions; kind: ProposalKind; scope: ProposalScopeInput | null }
  | { phase: "error"; message: string }
  | { phase: "cancelled"; reason: CancelReason };

export const IDLE: ProposalState = { phase: "idle" };

/** C02-2: the browser aborts at 25 s, five seconds after the server's own 20 s. */
export const CLIENT_TIMEOUT_MS = 25_000;

export const ERROR_MESSAGES = {
  timeout: "제안 응답 시간이 초과되었습니다. 원문과 최종 프롬프트는 그대로입니다.",
  network: "제안 서버에 연결하지 못했습니다. 원문과 최종 프롬프트는 그대로입니다.",
  unauthorized: "인증이 만료되었습니다. 새로고침 후 다시 시도하세요.",
  too_large: "제안 요청이 너무 큽니다. 설명을 조금 줄여 주세요.",
  invalid: "제안 요청 형식이 올바르지 않습니다. 화면을 새로고침해 주세요.",
  malformed: "제안 응답 형식이 올바르지 않아 적용하지 않았습니다.",
  mismatched: "다른 요청의 응답이라 적용하지 않았습니다.",
} as const;

export const CANCELLED_MESSAGES = {
  user: "제안 요청을 취소했습니다. 원문과 선택은 그대로입니다.",
  stale_revision: "원문이나 선택이 바뀌어 이전 제안을 버렸습니다. 원문과 최종 프롬프트는 그대로입니다.",
} as const;

/** C01-2 kinds plus VAR01. All three are built by `proposalBody`. */
export const PROPOSAL_KIND = "selection_hint";
export const PARTIAL_KIND = "partial_change";
/** VAR01: place/action-only situations. Candidates are shown, never accepted. */
export const VARIANT_KIND = "situation_variants";
export type ProposalKind = typeof PROPOSAL_KIND | typeof PARTIAL_KIND | typeof VARIANT_KIND;

/**
 * C01-2 caps. `MAX_FREE_TEXT` is a *character* cap on the description itself, keeping
 * the textarea honest; the wire limit is the byte check in `proposalBody` (LLM-R04),
 * which is what the server actually enforces.
 */
export const MAX_FREE_TEXT = 4000;
export const MAX_SELECTIONS = 100;

/**
 * LLM-R04: the server rejects a body over 8 KiB, measured in **bytes**, not characters.
 *
 * `MAX_FREE_TEXT` is a character cap, and Korean text is three bytes per character in
 * UTF-8: 4,000 characters is ~12 KB, so a request could pass every local check and still
 * come back 413. The check below therefore encodes the finished body and compares its
 * real byte length. The number is duplicated from
 * `backend/app/services/proposal_provider.py:MAX_REQUEST_BYTES`; the local check is a
 * courtesy, and the server remains the authority.
 */
export const MAX_REQUEST_BYTES = 8 * 1024;

const encoder = new TextEncoder();

/** UTF-8 byte length of a string, so a Korean character counts as 3, not 1. */
export const utf8Bytes = (value: string): number => encoder.encode(value).length;

/** VAR01 caps. Mirror the server so a long candidate is trimmed, never rendered raw. */
export const MAX_VARIANTS = 3;
export const MAX_VARIANT_LABEL_CHARS = 40;
export const MAX_VARIANT_PROMPT_CHARS = 200;
export const MAX_VARIANT_IDS = 20;

export type ProposalBody = {
  kind: ProposalKind;
  request_id: string;
  target_family: string;
  dictionary_version: string;
  free_text_ko: string;
  selections: { id: string; category: string }[];
  /**
   * `partial_change` only. Omitted for `selection_hint`, so that request stays
   * byte-identical to the I04 shape the contract tests already fix.
   */
  locked_ids?: string[];
  target_groups?: string[];
  revisions: ProposalRevisions;
};

/** The scope a request may carry. Empty means "whole scene" (`selection_hint`). */
export type ProposalScopeInput = { targetGroups: string[]; lockedIds: string[] };


const fingerprint = (value: string): string => `sha256:${sha256Hex(value)}`;

/**
 * The three fingerprints of C01-2. They are opaque to the server (it only echoes
 * them), so what matters is that every input that changes the meaning of a
 * proposal changes at least one of them: family, free text, selection IDs and
 * their categories. Order is preserved because selection order is visible.
 */
export function revisionsFor(scene: SceneSpecification): ProposalRevisions {
  const pairs = scene.selections.map((item) => `${item.id}:${item.category}`);
  return {
    scene: fingerprint(JSON.stringify([scene.targetFamily, scene.freeTextKo, pairs])),
    selection: fingerprint(JSON.stringify([scene.targetFamily, pairs])),
    text: fingerprint(scene.freeTextKo),
  };
}

export function sameRevisions(a: ProposalRevisions, b: ProposalRevisions): boolean {
  return a.scene === b.scene && a.selection === b.selection && a.text === b.text;
}

/** `request_id` grammar from C01-2: 8–64 chars, `[A-Za-z0-9_-]` only. */
export function newRequestId(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 24; i += 1) id += alphabet[Math.floor(random() * alphabet.length)];
  return `req-${id}`;
}

export type ProposalInput = {
  scene: SceneSpecification;
  family: string;
  dictionaryVersion: string;
  requestId: string;
  /** LLM-I06. Absent/empty keeps the I04 `selection_hint` request unchanged. */
  scope?: ProposalScopeInput;
  /**
   * VAR01: asks for situation candidates instead of suggestions. `scope` must then
   * name the groups a candidate may change (`VARIANT_GROUPS`), because a candidate
   * that may rewrite anything is a full-scene replacement and not a comparison.
   * The composer does not call this yet: the request button is VAR02.
   */
  variant?: boolean;
};

/** VAR01: a candidate may change place and action only — the cast stays fixed. */
export const VARIANT_GROUPS = ["pose", "setting"] as const;

/**
 * Builds the request or refuses it before the network. The local checks mirror the
 * server caps so an over-long text shows a Korean sentence instead of a 422.
 *
 * `scope` switches the kind to `partial_change`: the locked IDs are the current
 * selections outside the target groups, so the server can reject a reply that tries
 * to change them (C01-4 `locked`) before the UI ever shows it.
 *
 * `variant` switches it again to `situation_variants`. Its targets must all be
 * `VARIANT_GROUPS`: a candidate may swap place and action only, so asking for a
 * lighting candidate would be a `partial_change` wearing the wrong kind.
 */
export function proposalBody(
  input: ProposalInput,
): { body: ProposalBody } | { code: keyof typeof ERROR_MESSAGES } {
  const text = input.scene.freeTextKo;
  if (!input.family.trim() || !input.dictionaryVersion.trim()) return { code: "invalid" };
  if (!text.trim()) return { code: "invalid" };
  if (text.length > MAX_FREE_TEXT) return { code: "too_large" };
  if (input.scene.selections.length > MAX_SELECTIONS) return { code: "too_large" };
  const target = input.scope?.targetGroups ?? [];
  // A scope with no target group is not "partial": it keeps the I04 request shape.
  // `partialScope()` already dropped unknown groups, so a non-empty list here names
  // at least one group the server understands.
  const variant = input.variant === true;
  const variantGroups = target.filter((group): group is typeof VARIANT_GROUPS[number] =>
    (VARIANT_GROUPS as readonly string[]).includes(group));
  // A candidate without a changeable group could only be rejected as `out_of_scope`,
  // so the request is refused instead of sent to fail server-side.
  if (variant && variantGroups.length !== target.length) return { code: "invalid" };
  if (variant && target.length === 0) return { code: "invalid" };
  const partial = !variant && target.length > 0;
  const locked = input.scope?.lockedIds ?? [];
  if ((partial || variant) && locked.length > MAX_SELECTIONS) return { code: "too_large" };
  const body: ProposalBody = {
    kind: variant ? VARIANT_KIND : partial ? PARTIAL_KIND : PROPOSAL_KIND,
    request_id: input.requestId,
    target_family: input.family,
    dictionary_version: input.dictionaryVersion,
    free_text_ko: text,
    selections: input.scene.selections.map((item) => ({ id: item.id, category: item.category })),
    revisions: revisionsFor(input.scene),
  };
  if (partial || variant) {
    body.target_groups = [...target];
    body.locked_ids = [...locked];
  }
  // LLM-R04: the server counts bytes. `selections` and `locked_ids` are part of the
  // body too, so the whole thing is measured instead of only the free text: 60 selected
  // and 60 locked IDs already consume most of the 8 KiB before any Korean is written.
  if (utf8Bytes(JSON.stringify(body)) > MAX_REQUEST_BYTES) return { code: "too_large" };
  return { body };
}

/** What the transport produced. The reducer alone decides whether it is shown. */
export type ProposalOutcome =
  | { kind: "reply"; reply: ProposalReply }
  | { kind: "error"; code: keyof typeof ERROR_MESSAGES }
  | { kind: "cancelled"; reason: CancelReason };

export function startProposal(
  state: ProposalState,
  options: { requestId: string; revisions: ProposalRevisions; kind?: ProposalKind; scope?: ProposalScopeInput | null },
): ProposalState {
  const kind = options.kind ?? PROPOSAL_KIND;
  const scope = options.scope ?? null;
  // A new request replaces the old id, which is itself the out-of-order guard.
  return state.phase === "loading" && state.requestId === options.requestId
    ? state
    : { phase: "loading", requestId: options.requestId, revisions: options.revisions, kind, scope };
}

export function isPending(state: ProposalState): state is Extract<ProposalState, { phase: "loading" }> {
  return state.phase === "loading";
}

/**
 * The single place a reply may enter the screen.
 *
 * Dropped silently: anything when no request is in flight, and anything whose
 * `requestId` is not the current one (that is an older request finishing late).
 *
 * Dropped with a notice: a reply to revisions the user has since edited past.
 *
 * Rejected: a reply that answers a different `request_id`, or one whose revisions
 * are not the revisions we sent. Both are protocol errors, not user conditions.
 */
export function settleProposal(
  state: ProposalState,
  options: { requestId: string; outcome: ProposalOutcome; currentRevisions: ProposalRevisions },
): ProposalState {
  if (state.phase !== "loading" || state.requestId !== options.requestId) return state;
  const { outcome, currentRevisions } = options;
  if (outcome.kind === "cancelled") return { phase: "cancelled", reason: outcome.reason };
  if (outcome.kind === "error") return { phase: "error", message: ERROR_MESSAGES[outcome.code] };

  const { reply } = outcome;
  if (reply.request_id !== null && reply.request_id !== state.requestId) {
    return { phase: "error", message: ERROR_MESSAGES.mismatched };
  }
  if (reply.revisions !== null && !sameRevisions(reply.revisions, state.revisions)) {
    return { phase: "error", message: ERROR_MESSAGES.mismatched };
  }
  // LLM-I06: the reply echoes the kind it answered. A `partial_change` answer to a
  // full-cleanup request (or the reverse) would be judged against the wrong scope, so
  // it is refused as a protocol error instead of shown.
  if (reply.kind !== null && reply.kind !== state.kind) {
    return { phase: "error", message: ERROR_MESSAGES.mismatched };
  }
  if (!sameRevisions(currentRevisions, state.revisions)) {
    // The answer is correct for the state that was sent and wrong for the screen.
    return { phase: "cancelled", reason: "stale_revision" };
  }
  const { revisions, kind, scope } = state;
  if (reply.status === "ready") return { phase: "ready", reply, revisions, acceptedIds: [], kind, scope };
  if (reply.status === "empty") return { phase: "empty", reply, revisions, acceptedIds: [], kind, scope };
  return { phase: "unavailable", reply, revisions, kind, scope };
}

/** Explicit cancel. An already-finished state is left alone. */
export function cancelProposal(state: ProposalState): ProposalState {
  return state.phase === "loading" ? { phase: "cancelled", reason: "user" } : state;
}

/**
 * A state change elsewhere (text, family, selection) discards a request in flight and
 * any suggestion computed for the state the user has left. `error`/`cancelled`/
 * `unavailable` are historical status lines and stay: they describe a moment, not a
 * suggestion that could be accepted.
 */
export function invalidateProposal(state: ProposalState, currentRevisions: ProposalRevisions): ProposalState {
  const scoped = state.phase === "loading" || state.phase === "ready" || state.phase === "empty";
  return scoped && !sameRevisions(state.revisions, currentRevisions)
    ? { phase: "cancelled", reason: "stale_revision" }
    : state;
}

/**
 * LLM-I05: accepting a card edits the selection, which moves the fingerprint. The
 * reply was computed for the same *text* and the same model family, and the user just
 * acted on it, so the remaining cards stay valid: the state is re-based on the new
 * fingerprint instead of being withdrawn as stale.
 *
 * Only `ready`/`empty` are re-based. `loading` is untouched, so a reply still in
 * flight is judged against the state it was sent for, and a changed *text* always
 * wins over the re-base.
 */
export function reapplyProposal(
  state: ProposalState,
  currentRevisions: ProposalRevisions,
  acceptedIds: Iterable<string> = [],
): ProposalState {
  const scoped = state.phase === "ready" || state.phase === "empty";
  if (!scoped || state.revisions.text !== currentRevisions.text) return state;
  const added = [...acceptedIds].filter((id) => !state.acceptedIds.includes(id));
  return {
    ...state,
    revisions: currentRevisions,
    acceptedIds: added.length ? [...state.acceptedIds, ...added] : state.acceptedIds,
  };
}

/**
 * LLM-I06: undoing an acceptance removes those IDs from the scene, which moves the
 * fingerprint again. The remaining cards stay usable exactly like a fresh accept, and
 * the revoked IDs leave `acceptedIds` so the status line stops counting them.
 *
 * Only `ready`/`empty` are touched, and only when the *text* is unchanged: a text edit
 * still withdraws the reply through `invalidateProposal`.
 */
export function unapplyProposal(
  state: ProposalState,
  currentRevisions: ProposalRevisions,
  removedIds: Iterable<string> = [],
): ProposalState {
  const scoped = state.phase === "ready" || state.phase === "empty";
  if (!scoped || state.revisions.text !== currentRevisions.text) return state;
  const dropped = new Set(removedIds);
  return {
    ...state,
    revisions: currentRevisions,
    acceptedIds: state.acceptedIds.filter((id) => !dropped.has(id)),
  };
}

/**
 * LLM-I05: an explicit refusal. The cards and the status line disappear and the
 * selection is untouched — rejecting is not a silent edit.
 */
export function dismissProposal(state: ProposalState): ProposalState {
  return state.phase === "ready" || state.phase === "empty" || state.phase === "unavailable"
    ? IDLE
    : state;
}

export type ProposalSend = (body: ProposalBody, signal: AbortSignal) => Promise<unknown>;

/**
 * One explicit attempt, raced against a client timeout. No retry, no queue.
 *
 * The abort signal is owned here so a user cancel and the timeout share one code
 * path; a cancelled fetch rejects, which is why the outcome is classified instead
 * of propagated as an exception.
 */
export async function runProposal(options: {
  body: ProposalBody;
  send: ProposalSend;
  signal?: AbortSignal;
  timeoutMs?: number;
  parse?: (raw: unknown) => ProposalReply | null;
}): Promise<ProposalOutcome> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) return { kind: "cancelled", reason: "user" };
  options.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? CLIENT_TIMEOUT_MS);
  try {
    const raw = await options.send(options.body, controller.signal);
    const reply = (options.parse ?? parseReply)(raw);
    if (!reply) return { kind: "error", code: "malformed" };
    return { kind: "reply", reply };
  } catch (reason) {
    if (timedOut) return { kind: "error", code: "timeout" };
    if (controller.signal.aborted) return { kind: "cancelled", reason: "user" };
    return { kind: "error", code: classify(reason) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

const STATUSES = new Set(["ready", "empty", "unavailable", "unsupported_v1"]);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value : [])
  .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  .map((item) => item.trim());

/**
 * VAR01: one candidate, or `null` when it is not renderable.
 *
 * A candidate is dropped rather than repaired: a Korean sentence cut at the cap, or
 * one with no id, would describe a situation the model did not propose. The server
 * rejects those replies outright; this is the client's own copy of the same rule for
 * a stubbed or replayed answer.
 */
function readVariant(raw: unknown): ProposalVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const variantId = typeof item.variant_id === "string" ? item.variant_id.trim() : "";
  const promptKo = typeof item.prompt_ko === "string" ? item.prompt_ko.trim() : "";
  const labelKo = typeof item.label_ko === "string" && item.label_ko.trim().length > 0
    ? item.label_ko.trim() : promptKo;
  if (!variantId || !promptKo) return null;
  if (labelKo.length > MAX_VARIANT_LABEL_CHARS) return null;
  if (promptKo.length > MAX_VARIANT_PROMPT_CHARS) return null;
  return {
    variant_id: variantId,
    label_ko: labelKo,
    prompt_ko: promptKo,
    changed_ids: strings(item.changed_ids).slice(0, MAX_VARIANT_IDS),
    removed_ids: strings(item.removed_ids).slice(0, MAX_VARIANT_IDS),
    unresolved_ko: strings(item.unresolved_ko).slice(0, MAX_VARIANT_IDS),
  };
}

/**
 * The candidate list of a `situation_variants` reply.
 *
 * `truncated` covers both cuts this function makes (more than three candidates, a
 * repeated `variant_id`, a malformed entry) and the server's own flag is OR-ed in by
 * the caller. Order is preserved so the three cards do not reshuffle.
 */
export function parseVariants(raw: unknown): { variants: ProposalVariant[]; truncated: boolean } {
  const items = Array.isArray(raw) ? raw : [];
  const variants: ProposalVariant[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const entry of items) {
    const variant = readVariant(entry);
    if (!variant || seen.has(variant.variant_id)) { truncated = true; continue; }
    seen.add(variant.variant_id);
    variants.push(variant);
  }
  if (variants.length > MAX_VARIANTS) {
    truncated = true;
    variants.length = MAX_VARIANTS;
  }
  return { variants, truncated };
}

/** A reply is adopted only if it has a status v1 defines. Nothing is guessed. */
export function parseReply(raw: unknown): ProposalReply | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const status = value.status;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;
  const text = (key: string): string | null =>
    (typeof value[key] === "string" ? String(value[key]) : null);
  const list = (key: string): unknown[] =>
    (Array.isArray(value[key]) ? (value[key] as unknown[]) : []);
  const revisions = value.revisions;
  const kind = text("kind");
  // VAR01: candidates belong to their own kind. A `selection_hint` reply that carried
  // `variants` would mean something else on screen, so it is read as no candidates at
  // all and the reply is judged on its suggestions only.
  const parsed = kind === VARIANT_KIND ? parseVariants(value.variants) : { variants: [], truncated: false };
  return {
    proposal_id: text("proposal_id"),
    request_id: text("request_id"),
    status: status as ProposalReply["status"],
    kind,
    provider: value.provider && typeof value.provider === "object"
      ? (value.provider as ProposalProvider) : null,
    revisions: revisions && typeof revisions === "object"
      ? (revisions as ProposalRevisions) : null,
    suggestions: list("suggestions").filter((item): item is ProposalSuggestion =>
      Boolean(item) && typeof item === "object"
      && typeof (item as { id?: unknown }).id === "string"),
    variants: parsed.variants,
    unresolved_spans: list("unresolved_spans").filter((item): item is ProposalSpan =>
      Boolean(item) && typeof item === "object"),
    ambiguities: list("ambiguities").filter((item): item is ProposalAmbiguity =>
      Boolean(item) && typeof item === "object"),
    rejected: list("rejected").filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object"),
    truncated: value.truncated === true || parsed.truncated,
    why: text("why"),
    message: text("message"),
    detail: text("detail"),
  };
}

/** Transport failures are separated so the user sees one actionable sentence. */
function classify(reason: unknown): keyof typeof ERROR_MESSAGES {
  const status = (reason as { status?: unknown } | null)?.status;
  if (status === 401) return "unauthorized";
  if (status === 413) return "too_large";
  if (status === 422) return "invalid";
  return "network";
}

export type ProposalNotice = { tone: "info" | "caution" | "error"; text: string };

/** One line for the status area. `null` means "nothing to say yet". */
export function proposalNotice(state: ProposalState): ProposalNotice | null {
  switch (state.phase) {
    case "idle":
      return null;
    case "loading":
      return { tone: "info", text: "제안을 만들고 있습니다. 원문과 최종 프롬프트는 그대로입니다." };
    case "ready":
      if (state.acceptedIds.length > 0) {
        return { tone: "info",
          text: `제안 ${state.acceptedIds.length}개를 선택에 반영했습니다. 원문과 최종 프롬프트는 그대로입니다.` };
      }
      // VAR01: candidates are not suggestions and cannot be accepted, so the count
      // must name them as situations the user compares, not as items to add.
      if (state.kind === VARIANT_KIND) {
        return { tone: "info",
          text: `상황 후보 ${state.reply.variants.length}개를 받았습니다. 아직 선택에 반영하지 않았습니다.` };
      }
      return { tone: "info",
        text: `제안 ${state.reply.suggestions.length}개를 받았습니다. 아직 선택에 반영하지 않았습니다.` };
    case "empty":
      return { tone: "info",
        text: state.kind === VARIANT_KIND
          ? "바꿀 수 있는 장소·행동 후보를 만들지 못했습니다. 원문은 그대로 남습니다."
          : "원문에서 사전 항목을 찾지 못했습니다. 원문은 그대로 남습니다." };
    case "unavailable":
      return { tone: "caution",
        text: state.reply.message ?? "이 서버에서는 AI 제안을 지금 사용할 수 없습니다." };
    case "error":
      return { tone: "error", text: state.message };
    case "cancelled":
      return { tone: "info", text: CANCELLED_MESSAGES[state.reason] };
  }
}

