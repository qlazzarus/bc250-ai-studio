import type { PromptComposition } from "../api";
import { SD15_TOKEN_WINDOW, estimateTokens } from "./compiler.ts";
import { REMAINDER_LIMIT } from "./remainder.ts";
import type { ProposalTranslation } from "./llmProposals.ts";

/**
 * TRANS04/TRANS05: an out-of-dictionary translation as a card the user may include.
 *
 * Four invariants, each of which has a wrong version that looks right:
 *
 * 1. **Excluded by default.** Today's behaviour is "the phrase is not in the final
 *    prompt", so a card that arrives pre-ticked would silently change what gets
 *    generated. Inclusion is a click.
 * 2. **`free_text_ko` is never edited.** The Korean sentence is the user's text and the
 *    evidence for every offset; rewriting it would make the card's own `source_ko`
 *    stale. Only the final prompt and the recorded `remainder` change.
 * 3. **Not a selection.** A translation never becomes a dictionary ID, so it cannot be
 *    highlighted, removed or re-compiled like one. It is appended after the draft, in
 *    the same way `verbatim` mode appends the raw text.
 * 4. **`draft_prompt`/`compiler_version` untouched.** The draft stays the compiler's
 *    output; TRANS01 §5.1 depends on that separation for reproducibility.
 */

/** One card: the phrase, its translation, and whether the user included it. */
export type TranslationCard = {
  /** Stable key. `source_ko` is unique per reply, so it is the identity. */
  key: string;
  sourceKo: string;
  suggestedEn: string;
  confidence: number;
};

export type TranslationCards = {
  cards: TranslationCard[];
  /** How many the server reported dropping, so the header is never silently short. */
  truncated: boolean;
};

/** Cards from a `remainder_translation` reply, in reply order. */
export function translationCards(reply: { translations: ProposalTranslation[]; truncated: boolean }): TranslationCards {
  return {
    cards: reply.translations.map((item) => ({
      key: item.source_ko,
      sourceKo: item.source_ko,
      suggestedEn: item.suggested_en,
      confidence: item.confidence,
    })),
    truncated: reply.truncated,
  };
}

/**
 * The final prompt: the draft, then the included translations in acceptance order.
 *
 * `\n` is not a new separator — `withGeneratedDraft` already joins the verbatim raw
 * text the same way, and `, `/`; ` are taken by the compiler and the natural-language
 * families. Reusing the precedent keeps "compiler output" and "user addition"
 * distinguishable in the string itself.
 */
export function finalPrompt(draft: string, included: string[]): string {
  const tail = included.filter((item) => item.trim().length > 0);
  if (tail.length === 0) return draft;
  return draft ? `${draft}\n${tail.join("\n")}` : tail.join("\n");
}


/**
 * Pre-inclusion sd15 warning, computed with the compiler's own estimator.
 *
 * TRANS01 §5.3: the number to judge is the *final* prompt, and no second estimator is
 * allowed — two formulas guarantee that one of them is wrong. The warning is shown
 * before the click because that is the only moment the information is actionable, and
 * it only reports when the inclusion is what pushes the prompt over the window; an
 * already-over-budget draft has its own warning from `compileScene`, and this one
 * would misattribute the cause.
 */
export type TokenPreview = {
  tokens: number;
  limit: number;
  /** `true` only when including this card is what crosses 77. */
  newlyOverBudget: boolean;
};

export function tokenPreview(
  draft: string, included: string[], candidate: string | null, family: string,
): TokenPreview | null {
  if (family !== "sd15") return null;
  const now = estimateTokens(finalPrompt(draft, included));
  const listed = candidate === null ? included : [...included, candidate];
  const after = estimateTokens(finalPrompt(draft, listed));
  return {
    tokens: after,
    limit: SD15_TOKEN_WINDOW,
    // `candidate === null` means "what the current inclusions already cost", which is
    // the baseline; the flag can only fire when a candidate was supplied.
    newlyOverBudget: candidate !== null && now <= SD15_TOKEN_WINDOW && after > SD15_TOKEN_WINDOW,
  };
}

/**
 * One accepted translation, in the exact shape `PromptComposition.remainder` stores.
 *
 * The type is derived from the wire type rather than restated, so a field the server
 * renames cannot leave this module writing a key nobody reads.
 */
export type AcceptedTranslation = NonNullable<PromptComposition["remainder"]>[number];

/**
 * ISO-8601 UTC with second precision: `YYYY-MM-DDTHH:MM:SSZ`.
 *
 * The server's pattern accepts exactly this and rejects `toISOString()`'s milliseconds
 * with a 422. `now` is a parameter, not a call inside, because the timestamp is part
 * of the recorded fact and a test has to be able to state it.
 */
export function acceptedAt(now: Date): string {
  return `${now.toISOString().slice(0, 19)}Z`;
}

/**
 * The `remainder` entry for one included card, or `null` when it cannot be recorded.
 *
 * `proposal_id`/`proposal_model` come from the reply that produced *this* card, not
 * from the newest reply: one composition can mix translations from several calls, and
 * "which model wrote this phrase" has to survive that (TRANS01 §4.1). A missing model
 * becomes `unknown` instead of `""`, because the server requires 1–200 characters and
 * an empty value would make the whole snapshot unsavable.
 */
export function remainderEntry(input: {
  card: TranslationCard;
  proposalId: string | null;
  proposalModel: string | null;
  now: Date;
}): AcceptedTranslation | null {
  const proposalId = input.proposalId?.trim() ?? "";
  // The server's minimum is 8 characters. A shorter id cannot be saved, so the card is
  // refused now instead of producing a snapshot that only fails at submit time.
  if (proposalId.length < 8) return null;
  const sourceKo = input.card.sourceKo.trim();
  const suggestedEn = input.card.suggestedEn.trim();
  if (!sourceKo || !suggestedEn) return null;
  return {
    source_ko: sourceKo,
    suggested_en: suggestedEn,
    proposal_id: proposalId,
    proposal_model: input.proposalModel?.trim() || "unknown",
    accepted_at: acceptedAt(input.now),
  };
}

/**
 * Append one entry, preserving acceptance order and refusing a duplicate.
 *
 * `remainder` order is the order the user included the cards, which is the order they
 * appear in the final prompt. A duplicate `source_ko` would put the same Korean phrase
 * in the prompt twice, so it is a no-op. The cap is the server's `max_length`.
 */
export function includeRemainder(
  current: AcceptedTranslation[], entry: AcceptedTranslation,
): AcceptedTranslation[] {
  if (current.some((item) => item.source_ko === entry.source_ko)) return current;
  if (current.length >= REMAINDER_LIMIT) return current;
  return [...current, entry];
}

/** Remove the entry for one phrase: the per-card undo path. */
export function excludeRemainder(
  current: AcceptedTranslation[], sourceKo: string,
): AcceptedTranslation[] {
  return current.filter((item) => item.source_ko !== sourceKo);
}

/** The English strings of every recorded entry, in record order, for `finalPrompt`. */
export function includedEnglish(remainder: AcceptedTranslation[]): string[] {
  return remainder.map((item) => item.suggested_en);
}

/** `true` when this phrase is already in the recorded translations. */
export function isIncluded(remainder: AcceptedTranslation[], sourceKo: string): boolean {
  return remainder.some((item) => item.source_ko === sourceKo);
}

/**
 * Drop entries whose Korean phrase no longer appears in `freeTextKo`.
 *
 * TRANS05 records `source_ko` as *text*, which makes a stored snapshot truthful even
 * after an edit — but a live inclusion is a claim about the sentence on screen now. If
 * the user rewrites `비 오는 밤` to `맑은 낮`, keeping the translation would append
 * English for a phrase that is no longer there, and the snapshot would then describe a
 * sentence the model never received. Pruning is therefore about the current text, not
 * about the record.
 */
export function pruneRemainder(remainder: AcceptedTranslation[], freeTextKo: string): AcceptedTranslation[] {
  return remainder.filter((item) => freeTextKo.includes(item.source_ko));
}

/**
 * The inclusion list, plus the composition it was last written against.
 *
 * `owner` is what makes the list survive an apply without an effect: as long as the
 * composer's own list names the composition on screen, it is the truth (it may hold an
 * entry that pruning hides, which has to come back if the phrase is retyped); as soon as
 * a different composition appears — a restored generation, a gallery selection — that
 * record's translations take over.
 *
 * TRANS06: `epoch` is the second half of the rule, and it is what keeps "no composition
 * yet" apart from "the user started over". A family rebind keeps the recorded
 * composition (so `owner` still names it, and the accepted translations keep their
 * provenance across the rebind); an explicit restart does not, and `owner === null`
 * would then match a `null` applied composition and quietly carry the old list into a
 * new record. The epoch is incremented only by that restart, so it is the discriminator
 * — not `null` itself.
 */
export type InclusionList = {
  owner: PromptComposition | null;
  /** The composition epoch the list was written in. See `restartedBuilder`. */
  epoch: number;
  items: AcceptedTranslation[];
};

export const EMPTY_INCLUSIONS: InclusionList = { owner: null, epoch: 0, items: [] };

/**
 * The un-pruned list for the composition on screen.
 *
 * `epoch` first: a list written in an earlier composition is stale no matter what
 * `owner` says, so an explicit restart starts from the new record (usually nothing)
 * instead of inheriting translations the user left behind.
 *
 * Then `owner === applied`: while the local list names the composition on screen it is
 * the truth (so an entry hidden by a text edit comes back when the phrase is retyped),
 * and a different record hands over to its own translations.
 *
 * A restored v2 snapshot supplies its recorded translations, so applying its draft again
 * cannot silently re-record a v2 body without them. A v1 snapshot supplies none: it has
 * no `remainder` to inherit, and inventing one would turn a recorded v1 fact into v2.
 * A forgotten rebind must not lose them either — TRANS06 therefore keeps the applied
 * record on a model-family change instead of clearing it, which is what makes `owner`
 * still name it here.
 */
export function activeInclusions(
  list: InclusionList, applied: PromptComposition | null, epoch: number,
): AcceptedTranslation[] {
  if (list.epoch === epoch && list.owner === applied) return list.items;
  return applied?.schema_version === 2 ? applied.remainder ?? [] : [];
}
