import { blockReason, type CardBlock } from "./proposalCards.ts";
import type { DictionaryEntry } from "./dictionary";
import { groupOf } from "./presentation.ts";
import { VARIANT_GROUPS, type ProposalReply } from "./llmProposals.ts";
import type { SceneSpecification } from "./scene";

/**
 * VAR01: turns the `situation_variants` candidates into display cards.
 *
 * A candidate is a *situation*, not a suggestion: it has no dictionary id the user
 * could take, and taking it is VAR02's job. So this module returns text and the diff
 * a candidate would make — never an id to accept, never a scene to apply. Nothing
 * here is persisted, and nothing here changes the free text or the final prompt.
 *
 * The server already rejects a bad candidate outright. This is the client's own copy
 * of the same table, so a stubbed or replayed reply cannot show a candidate that
 * changes the person, the outfit or a locked value.
 */

/** `not_selected`/`no_change` have no suggestion counterpart, so they live here. */
export type VariantBlock = Extract<CardBlock, "not_in_dictionary" | "inactive"
  | "already_selected" | "locked" | "out_of_scope"> | "not_selected" | "no_change";

const EXTRA_TEXT: Record<"not_selected" | "no_change", string> = {
  not_selected: "지금 선택에 없는 항목입니다",
  no_change: "바뀌는 항목이 없습니다",
};

export function variantBlockReason(block: VariantBlock): string {
  return block === "not_selected" || block === "no_change"
    ? EXTRA_TEXT[block]
    : blockReason(block);
}

export type VariantChange = {
  id: string;
  /** Korean label, or the raw id when the dictionary cannot resolve it. */
  labelKo: string;
  /** Display group (`pose`/`setting`) — what the candidate is allowed to touch. */
  group: string;
  direction: "add" | "remove";
};

export type VariantCard = {
  /** Stable DOM key: a `variant_id` alone may repeat across replies. */
  key: string;
  variantId: string;
  labelKo: string;
  promptKo: string;
  changes: VariantChange[];
  /** Korean words the dictionary cannot express. Shown verbatim, never resolved. */
  unresolvedKo: string[];
  blocks: VariantBlock[];
  /** Display-only note: the family has no expression for at least one change. */
  unmappedFamily: boolean;
};

export type VariantSummary = {
  cards: VariantCard[];
  /** The server or the parser cut candidates: say so instead of hiding the rest. */
  truncated: boolean;
  /** Diagnostics only, like the suggestion panel's `rejectedCount`. */
  rejectedCount: number;
};

export type VariantInput = {
  reply: ProposalReply;
  scene: SceneSpecification;
  dictionary: DictionaryEntry[];
  /** Display family; an empty string means "no model chosen yet". */
  family: string;
  /**
   * The scope the request was sent with. The server rejects locked and out-of-scope
   * IDs; this keeps the promise for a reply that never reached it.
   */
  scope?: { targetGroups: string[]; lockedIds: string[] } | null;
};

function isMapped(entry: DictionaryEntry, family: string): boolean {
  if (!family) return true;
  const mapping = Object.hasOwn(entry.mappings, family)
    ? entry.mappings[family as keyof typeof entry.mappings]
    : undefined;
  return mapping?.status === "mapped" && Boolean(mapping.text.trim());
}

/**
 * Builds one card per candidate, in reply order.
 *
 * A blocked candidate is still carded: the user is comparing situations, and
 * silently dropping one would make the set look like the model's whole answer. The
 * block sentence explains why it cannot be shown as a usable situation.
 */
export function variantCards(input: VariantInput): VariantSummary {
  const { reply, scene, dictionary, family, scope } = input;
  const byId = new Map(dictionary.map((entry) => [entry.id, entry]));
  const selected = new Set(scene.selections.map((item) => item.id));
  const locked = new Set(scope?.lockedIds ?? []);
  const scoped = scope?.targetGroups ?? [];
  const allowed = new Set<string>(scoped.length > 0 ? scoped : VARIANT_GROUPS);
  const seen = new Set<string>();
  const cards: VariantCard[] = [];

  const readChange = (
    id: string, direction: VariantChange["direction"], blocks: VariantBlock[],
  ): VariantChange => {
    const entry = byId.get(id);
    if (!entry) {
      blocks.push("not_in_dictionary");
      return { id, labelKo: id, group: "", direction };
    }
    if (!entry.active) blocks.push("inactive");
    const group = groupOf(entry.category);
    if (!(VARIANT_GROUPS as readonly string[]).includes(group)) blocks.push("out_of_scope");
    if (locked.has(id)) blocks.push("locked");
    else if (direction === "add" && selected.has(id)) blocks.push("already_selected");
    if (direction === "remove" && !selected.has(id)) blocks.push("not_selected");
    // A group outside `target_groups` is what the request said not to change.
    if (scoped.length > 0 && !allowed.has(group)) blocks.push("out_of_scope");
    return { id, labelKo: entry.labelKo, group, direction };
  };

  for (const [index, variant] of reply.variants.entries()) {
    if (seen.has(variant.variant_id)) continue;
    seen.add(variant.variant_id);
    const blocks: VariantBlock[] = [];
    const changes = [
      ...variant.changed_ids.map((id) => readChange(id, "add", blocks)),
      ...variant.removed_ids.map((id) => readChange(id, "remove", blocks)),
    ];
    if (changes.length === 0) blocks.push("no_change");
    const unmappedFamily = changes.some((change) => {
      const entry = byId.get(change.id);
      return entry !== undefined && !isMapped(entry, family);
    });
    cards.push({
      key: `v:${index}:${variant.variant_id}`,
      variantId: variant.variant_id,
      labelKo: variant.label_ko || variant.prompt_ko,
      promptKo: variant.prompt_ko,
      changes,
      unresolvedKo: [...variant.unresolved_ko],
      blocks: [...new Set(blocks)],
      unmappedFamily,
    });
  }

  return { cards, truncated: reply.truncated === true, rejectedCount: reply.rejected.length };
}

/** One line for the panel head. Empty when there is nothing to show. */
export function variantHeadline(summary: VariantSummary): string {
  if (summary.cards.length === 0) return "";
  const blocked = summary.cards.filter((card) => card.blocks.length > 0).length;
  return blocked === 0
    ? `상황 후보 ${summary.cards.length}개`
    : `상황 후보 ${summary.cards.length}개 · 표시 불가 ${blocked}`;
}

