import type { PromptComposition } from "../api";
import type { CompileResult } from "./compiler";
// TRANS06: the composition epoch is part of the rule, so it lives in the state.
import { finalPrompt, includedEnglish, type AcceptedTranslation } from "./remainderInclusion.ts";
import type { SceneSpecification } from "./scene";

export type FreeTextMode = "separate" | "verbatim";
export type PromptBuilderState = {
  scene: SceneSpecification; result: CompileResult | null; generatedFrom: string | null;
  applied: PromptComposition | null; freeTextMode: FreeTextMode; generatedMode: FreeTextMode | null;
  provenance: "current" | "saved"; appliedScene: string | null; appliedPrompt: string | null;
  /**
   * TRANS06: which composition session this is, incremented only by `restartBuilder`.
   *
   * It exists to keep two situations apart that both look like "no applied composition":
   * a translation included before the first apply (`applied === null`, must survive into
   * that apply) and a brand-new composition started from a restored generation (must not
   * inherit the previous session's list). `activeInclusions` compares it against the
   * list's own epoch; see `InclusionList`.
   */
  compositionEpoch: number;
};
export const initialBuilderState: PromptBuilderState = {
  scene: { schemaVersion: 1, targetFamily: "", selections: [], freeTextKo: "" }, result: null, generatedFrom: null, applied: null,
  freeTextMode: "separate", generatedMode: null, provenance: "current", appliedScene: null, appliedPrompt: null,
  compositionEpoch: 0,
};

/**
 * TRANS06: the explicit "start over" transition.
 *
 * Restoring a generation without a composition is a new composition, not a continuation
 * of the one on screen, so the epoch moves and the composer's inclusion list (which is
 * keyed by epoch) stops applying. This is deliberately *not* what a model-family change
 * does: a rebind keeps the record (see `withReboundFamily`), and only this function
 * discards the session.
 */
export function restartBuilder(state: PromptBuilderState): PromptBuilderState {
  return { ...initialBuilderState, compositionEpoch: state.compositionEpoch + 1 };
}

export function isDraftStale(state: PromptBuilderState): boolean {
  return state.result !== null && (JSON.stringify(state.scene) !== state.generatedFrom || state.freeTextMode !== state.generatedMode);
}

/** Compose from fresh compiler output, never from the editable final prompt. */
export function withGeneratedDraft(state: PromptBuilderState, result: CompileResult): PromptBuilderState {
  const raw = state.scene.freeTextKo;
  const draft = state.freeTextMode === "verbatim" && raw.length
    ? (result.draft ? `${result.draft}\n${raw}` : raw) : result.draft;
  return { ...state, result: { ...result, draft }, generatedFrom: JSON.stringify(state.scene),
    generatedMode: state.freeTextMode, provenance: "current" };
}

export function draftComposition(state: PromptBuilderState, remainder: AcceptedTranslation[] = []): PromptComposition | null {
  if (!state.result) return null;
  // TRANS01 §2.4/§4.4: the version describes what the snapshot contains. A composition
  // with no accepted translation stays v1, so an old-shaped record keeps its shape.
  const base: PromptComposition = {
    schema_version: 1, compiler_version: state.result.compilerVersion, target_family: state.scene.targetFamily,
    selections: state.scene.selections.map((item) => ({ id: item.id, category: item.category, label_ko: item.labelKo,
      dictionary_version: item.dictionaryVersion, mapping_status: item.mapping.status,
      rendered: item.mapping.status === "mapped" ? item.mapping.text : null })),
    free_text_ko: state.scene.freeTextKo, draft_prompt: state.result.draft, unresolved: state.result.unresolved,
  };
  if (remainder.length === 0) return base;
  return { ...base, schema_version: 2, remainder };
}

/**
 * TRANS05: apply the draft, optionally appending the accepted translations.
 *
 * This is the only place the final prompt is assembled. `draft_prompt` stays the
 * compiler's output and `compiler_version` is untouched — the translations live in
 * `remainder` alone (TRANS01 §5.1). `appliedPrompt` records what was written, so the
 * existing "prompt modified since apply" status keeps working.
 */
export function withAppliedDraft(
  state: PromptBuilderState,
  appliedPrompt?: string,
  remainder: AcceptedTranslation[] = [],
): PromptBuilderState {
  if (!state.result || isDraftStale(state)) return state;
  // An explicit `appliedPrompt` still wins: the `separateOnly` path applies the
  // composition without touching the final prompt, so it passes the current value.
  const prompt = appliedPrompt ?? finalPrompt(state.result.draft, includedEnglish(remainder));
  return { ...state, applied: draftComposition(state, remainder), appliedScene: JSON.stringify(state.scene), appliedPrompt: prompt };
}

export function applicationStatus(state: PromptBuilderState, prompt: string) {
  return {
    selectionChanged: state.applied !== null && JSON.stringify(state.scene) !== state.appliedScene,
    promptModified: state.appliedPrompt !== null && prompt !== state.appliedPrompt,
    historicalApplicationUnknown: state.applied !== null && state.appliedPrompt === null,
  };
}

/** The approved snapshot only describes the model family it was compiled for. */
export function appliedForFamily(state: PromptBuilderState, family: string, supported = true): PromptComposition | null {
  return supported && state.applied && state.applied.target_family === family ? state.applied : null;
}

/**
 * TRANS06: keep the record while the draft is discarded for a new model family.
 *
 * The draft has to go — it was compiled for the other family, and `previewControls`'s
 * `familyMismatch` exists precisely so it cannot be applied. The applied composition is
 * a different matter: it is a *record* of what was recorded, not a draft. Dropping it
 * threw away two things at once, and neither had to go:
 *
 * - the accepted translations and their provenance, which the inclusion panel reads, and
 * - `owner`'s identity, so the next apply re-records the same `remainder` instead of a v1
 *   body (the regression this task exists for).
 *
 * Keeping it cannot leak across families: `appliedForFamily` gates submission on
 * `target_family`, so the server never receives a composition that names the other family.
 *
 * `provenance` stays "current" because the draft really is gone; "saved" would be a lie.
 * `appliedScene` is left alone on purpose — the rebind changes the selections, so
 * `applicationStatus` reports `selectionChanged`, which is exactly what happened. The
 * final prompt is untouched, as before, and `scene` is supplied already rebound.
 */
export function withReboundFamily(state: PromptBuilderState, scene: SceneSpecification): PromptBuilderState {
  return { ...state, scene, result: null, generatedFrom: null, generatedMode: null, provenance: "current" };
}

/**
 * TRANS06: the record whose translations survive a family rebind.
 *
 * `applied` keeps the composition; `appliedScene`/`appliedPrompt` are what decide whether
 * it still describes this screen. The translations in `applied.remainder` are the
 * provenance a rebind must not lose: the English is already in the final prompt and the
 * record is the only account of where it came from.
 *
 * The scene string is deliberately left as it was. A rebind rebinds the selections, so
 * `applicationStatus` reports `selectionChanged` — which is the truth, and the existing
 * "적용 후 선택 변경됨" sentence already explains it. `appliedForFamily` still refuses to
 * submit the record for the new family, so the panel keeps the provenance without the
 * server ever receiving a composition that names the other family.
 */
export function appliedInclusions(state: PromptBuilderState): AcceptedTranslation[] {
  return state.applied?.schema_version === 2 ? state.applied.remainder ?? [] : [];
}

/**
 * TRANS01 §2.2 deployment guard: v2 keys only go to a server that advertises v2.
 *
 * The old server's `extra="forbid"` rejects `remainder` with a 422, so a new client
 * talking to an old server must send a v1 body. The translations are dropped rather
 * than kept on the side: a translation recorded locally but rejected by the server
 * would be a snapshot that does not match what was generated.
 */
export function v1OnlyWhenUnsupported(composition: PromptComposition, remainderSupported: boolean): PromptComposition {
  if (remainderSupported || composition.schema_version !== 2) return composition;
  const rest: PromptComposition = { ...composition, schema_version: 1 };
  // `delete` on the copy, not a rest destructure: the lint rule rejects the throwaway
  // binding a rest spread needs, and this records the intent more directly anyway.
  delete rest.remainder;
  return rest;
}

/**
 * Restore recorded facts only. Warnings/sources/application method were not recorded.
 *
 * TRANS05: a v1 snapshot is restored exactly as recorded — no `remainder` key is added,
 * because inventing an empty array would turn a v1 fact into a v2 one. `schema_version`
 * is likewise kept as recorded; only a re-save through `draftComposition` may raise it.
 * TRANS06: `epoch` is carried in rather than reset, so an epoch never repeats. A restore
 * is a new composition — the list from whatever was on screen must not attach itself to
 * the record being restored — but the number only ever moves forward, which is what makes
 * the comparison in `activeInclusions` safe.
 */
export function restoreComposition(composition: PromptComposition, epoch = 0): PromptBuilderState {
  const scene: SceneSpecification = {
    schemaVersion: 1, targetFamily: composition.target_family, freeTextKo: composition.free_text_ko,
    selections: composition.selections.map((item) => ({
      id: item.id, category: item.category, labelKo: item.label_ko, dictionaryVersion: item.dictionary_version,
      mapping: item.mapping_status === "mapped" && item.rendered !== null
        ? { status: "mapped", text: item.rendered } : { status: "unavailable" },
    })),
  };
  return { ...initialBuilderState, scene, compositionEpoch: epoch + 1, result: { draft: composition.draft_prompt,
    compilerVersion: composition.compiler_version, targetFamily: composition.target_family,
    unresolved: composition.unresolved, warnings: [], sources: [] }, generatedFrom: JSON.stringify(scene),
    generatedMode: "separate", provenance: "saved", appliedScene: JSON.stringify(scene), applied: composition };
}
