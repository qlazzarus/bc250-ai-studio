import { conflictsAmong } from "./compiler.ts";
import type { DictionaryEntry } from "./dictionary";
import { groupOf } from "./presentation.ts";
import type { ProposalReply, ProposalSuggestion } from "./llmProposals";
import type { SceneSpecification } from "./scene";

/**
 * LLM-I05: turns one validated proposal reply into cards the user may accept.
 *
 * Four kinds, because they answer different questions and must not be merged:
 *
 * - `quoted`     - the server found the phrase in the text (`basis: "quote"`).
 * - `inferred`   - the server guessed it; the text does not contain the phrase.
 * - `unresolved` - a span of the text no dictionary entry covers.
 * - `ambiguous`  - the server saw several readings and refused to pick one.
 *
 * Only `quoted` entries are eligible for batch acceptance (C01-3). Everything else is
 * per-item and manual. Nothing here mutates a scene: it returns decisions, and the
 * component calls the existing `selectEntry` with them.
 */

export type CardBlock = "duplicate" | "not_in_dictionary" | "inactive" | "already_selected"
  | "conflict" | "unmapped" | "locked" | "out_of_scope";

export type ProposalCard = {
  /** Stable DOM key. An id alone is not unique across spans and ambiguities. */
  key: string;
  kind: "quoted" | "inferred" | "unresolved" | "ambiguous";
  /** Dictionary id, or `null` for a span/ambiguity that has none. */
  id: string | null;
  labelKo: string;
  category: string;
  /** The exact text the card is about: a phrase from the source or a bare span. */
  text: string;
  confidence: number;
  reasonKo: string;
  /** Present only when the id resolves to an active dictionary entry. */
  entry: DictionaryEntry | null;
  /** Why this card cannot be accepted now. Empty means the button is offered. */
  blocks: CardBlock[];
  /** `true` only for a quoted, unblocked card: the batch action includes it. */
  batchEligible: boolean;
};

export type CardSummary = {
  cards: ProposalCard[];
  counts: Record<ProposalCard["kind"], number>;
  /** Ids the batch action would add, in reply order. */
  batchIds: string[];
  /** Cards excluded from the batch, with the reason a user can act on. */
  excluded: { key: string; labelKo: string; why: string }[];
  /** Reply-level flags worth one line: truncation and the 8-item displays. */
  truncated: boolean;
  /** Items the server dropped before answering (`rejected`). Diagnostics only. */
  rejectedCount: number;
};

const BLOCK_TEXT: Record<CardBlock, string> = {
  duplicate: "같은 항목이 두 번 왔습니다",
  not_in_dictionary: "사전에 없는 항목입니다",
  inactive: "지금은 쓰지 않는 항목입니다",
  already_selected: "이미 선택했습니다",
  conflict: "함께 쓸 수 없는 조합입니다",
  unmapped: "이 모델 계열에서는 변환되지 않습니다",
  locked: "이번 요청에서 고정한 값입니다",
  out_of_scope: "이번 요청의 변경 대상이 아닙니다",
};

export function blockReason(block: CardBlock): string {
  return BLOCK_TEXT[block];
}

/**
 * Why a card that *can* be accepted is still left out of the batch. `inferred` is not
 * a blocker: C01-3/C01-4 keep it display-only for batch acceptance, but the user may
 * still take it one by one, because it is a real dictionary entry.
 */
export const INFERRED_REASON = "원문에 근거 문구가 없습니다";

/** 0–100 for display only. The model's own number is kept as `confidence`. */
export function cardConfidence(card: ProposalCard): number | null {
  return Number.isFinite(card.confidence)
    ? Math.round(Math.min(1, Math.max(0, card.confidence)) * 100)
    : null;
}


/**
 * The mapping a *pending* acceptance would produce, so `unmapped` is judged against
 * the family the user is on rather than against the reply.
 */
function isMapped(entry: DictionaryEntry, family: string): boolean {
  if (!family) return true;
  const mapping = Object.hasOwn(entry.mappings, family)
    ? entry.mappings[family as keyof typeof entry.mappings]
    : undefined;
  return mapping?.status === "mapped" && Boolean(mapping.text.trim());
}

export type CardInput = {
  reply: ProposalReply;
  scene: SceneSpecification;
  dictionary: DictionaryEntry[];
  /** Display family; an empty string means "no model chosen yet". */
  family: string;
  /**
   * LLM-I06: the scope the request was sent with. The server already rejects locked
   * and out-of-scope IDs, so this is the client's own copy of the same rule — it keeps
   * the promise if a reply is stubbed, replayed or answered by an older server.
   */
  scope?: { targetGroups: string[]; lockedIds: string[] } | null;
};

/**
 * Builds the cards for one reply. Order follows the reply so the panel does not
 * reshuffle between two answers to the same text.
 */
export function proposalCards(input: CardInput): CardSummary {
  const { reply, scene, dictionary, family, scope } = input;
  const byId = new Map(dictionary.map((entry) => [entry.id, entry]));
  const selected = new Set(scene.selections.map((item) => item.id));
  const locked = new Set(scope?.lockedIds ?? []);
  const scoped = new Set(scope?.targetGroups ?? []);
  const cards: ProposalCard[] = [];
  const seen = new Set<string>();
  /** What the user would have if every unblocked card were accepted, in order. */
  const accepted = new Set(selected);

  const readSuggestion = (suggestion: ProposalSuggestion) => {
    const entry = byId.get(suggestion.id) ?? null;
    const blocks: CardBlock[] = [];
    if (seen.has(suggestion.id)) blocks.push("duplicate");
    seen.add(suggestion.id);
    if (!entry) blocks.push("not_in_dictionary");
    else {
      if (!entry.active) blocks.push("inactive");
      if (selected.has(entry.id)) blocks.push("already_selected");
      // LLM-I06: the request said "only these groups may change" and "these values are
      // fixed". A reply that ignores either is refused here, with the same sentence as
      // the server's `locked`/`out_of_scope` rejection. An item that is already chosen
      // is judged by that alone: the lock describes a value this acceptance would not
      // even touch, so adding it would read as a second, conflicting reason.
      else if (locked.has(entry.id)) blocks.push("locked");
      else if (scoped.size > 0 && !scoped.has(groupOf(entry.category))) blocks.push("out_of_scope");
      // Judge against the selection *after* the batch, so a card is flagged before
      // the user clicks and only then reads a compiler warning.
      if (conflictsAmong([...accepted, entry.id]).some((group) => group.includes(entry.id))) {
        blocks.push("conflict");
      }
      if (!isMapped(entry, family)) blocks.push("unmapped");
    }
    // `basis: "inferred"` keeps its per-item ability but never enters the batch
    // (C01-3). It is a note, not a blocker, so it does not hide the accept button.
    const inferred = suggestion.basis === "inferred";
    if (!blocks.length) accepted.add(suggestion.id);
    cards.push({
      key: `s:${suggestion.id}`,
      kind: inferred ? "inferred" : "quoted",
      id: suggestion.id,
      labelKo: entry?.labelKo ?? suggestion.id,
      category: entry?.category ?? "",
      text: suggestion.matched_phrase,
      confidence: suggestion.confidence,
      reasonKo: suggestion.reason_ko ?? "",
      entry: entry?.active ? entry : null,
      blocks,
      // Only a quoted card with no blocker may be taken by the batch action.
      batchEligible: !inferred && blocks.length === 0,
    });
  };

  for (const suggestion of reply.suggestions) readSuggestion(suggestion);

  for (const [index, span] of reply.unresolved_spans.entries()) {
    cards.push({
      key: `u:${index}:${span.text}`,
      kind: "unresolved", id: null, labelKo: span.text, category: "",
      text: span.text, confidence: Number.NaN, reasonKo: span.why ?? "",
      entry: null, blocks: ["not_in_dictionary"], batchEligible: false,
    });
  }

  for (const [index, ambiguity] of reply.ambiguities.entries()) {
    // Candidate ids are already validated by the server; unknown ones are dropped here
    // rather than shown as raw ids the user cannot look up.
    const names = (ambiguity.candidates ?? [])
      .map((id) => byId.get(id))
      .filter((entry): entry is DictionaryEntry => Boolean(entry))
      .map((entry) => entry.labelKo);
    const why = ambiguity.why ?? "actor_unknown";
    cards.push({
      key: `a:${index}:${ambiguity.text}`,
      kind: "ambiguous", id: null, labelKo: ambiguity.text, category: "",
      text: ambiguity.text, confidence: Number.NaN,
      reasonKo: names.length ? `${why} · 후보 ${names.join(", ")}` : why,
      entry: null, blocks: ["not_in_dictionary"], batchEligible: false,
    });
  }

  const counts = { quoted: 0, inferred: 0, unresolved: 0, ambiguous: 0 };
  for (const card of cards) counts[card.kind] += 1;
  const batchIds = cards
    .filter((card) => card.batchEligible && card.id !== null)
    .map((card) => card.id as string);
  // `already_selected` is not a rejection: the server omits those, and the client
  // only sees it when the user added the item between the request and the reply.
  const excluded: CardSummary["excluded"] = [];
  for (const card of cards) {
    if (card.id === null) continue;
    const why = card.blocks.find((block) => block !== "already_selected");
    if (why) excluded.push({ key: card.key, labelKo: card.labelKo, why: blockReason(why) });
    // Accepted individually, just never batched: the user has to decide on it.
    // A card that is already in the scene is not listed at all.
    else if (card.blocks.length === 0 && !card.batchEligible) {
      excluded.push({ key: card.key, labelKo: card.labelKo, why: INFERRED_REASON });
    }
  }

  return {
    cards, counts, batchIds, excluded,
    truncated: reply.truncated === true,
    rejectedCount: reply.rejected.length,
  };
}

