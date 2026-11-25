/**
 * UIX04: generation-settings display facts and error routing.
 *
 * Everything here is a pure derivation over values the form already owns. Three rules keep it
 * from becoming a second implementation of anything:
 *
 * - It never decides a capability. What Steps/CFG may be is `generation_options` from the
 *   model, read by `editable()`; this file only says what the *current* values are.
 * - It never re-validates the request. `validateSubmission` owns the body; the only check here
 *   is the seed, which `validateSubmission` has never covered because the seed is not part of
 *   the composition record.
 * - It touches no network and no React.
 */
import type { ValidationIssue } from "../prompt/validation";

/**
 * Fields in the order they are read top to bottom in the form.
 *
 * "The first error" has to mean the topmost one, not the first one a validator happened to
 * push: a body-wide byte error is produced last by `validateSubmission`, but a missing seed
 * sits *after* the prompt on screen, so push order and reading order disagree.
 */
export const FIELD_ORDER = [
  "prompt", "negative_prompt", "steps", "cfg_scale", "seed",
  "selections", "composition", "request",
] as const;

/** The control each movable field lives in. Fields without an entry have no single target. */
export const FIELD_SELECTOR: Record<string, string> = {
  prompt: "#prompt-final",
  negative_prompt: "#prompt-negative",
  steps: "#prompt-steps",
  cfg_scale: "#prompt-cfg",
  seed: "#prompt-seed",
};

/**
 * Fields drawn inside the folded 세부 생성 설정.
 *
 * Moving to one of these has to open the fold first: a `hidden` subtree cannot take focus, so
 * `focus()` would be a silent no-op and the user would be told "move here" with nothing moving.
 */
export const FIELD_IN_DETAILS = ["steps", "cfg_scale", "seed"];

/** Short names used in the blocking line, so it never says a raw request key. */
export const FIELD_LABEL: Record<string, string> = {
  prompt: "최종 프롬프트",
  negative_prompt: "Negative prompt",
  steps: "Steps",
  cfg_scale: "CFG",
  seed: "Seed",
};

/**
 * The one seed check the submit path uses.
 *
 * Kept byte-for-byte equivalent to the inline check it replaced: an integer `-1` or greater.
 * `-1` means "random" to the engine, so it must stay legal. The server's upper bound
 * (`2147483631`) is deliberately *not* mirrored: refusing a body the server accepts would
 * narrow the accepted range, which the task forbids. That bound stays a server answer.
 *
 * An empty box is not an error here, and never was: `Number("")` is `0`, so an empty seed
 * sends a fixed seed of 0. Changing that would be a new request contract, not a UI fix.
 */
export function seedIssue(seed: string): ValidationIssue | null {
  const value = Number(seed);
  return !Number.isInteger(value) || value < -1
    ? { field: "seed", message: "올바른 seed 값을 입력하세요." }
    : null;
}

const rank = (field: string): number => {
  const at = (FIELD_ORDER as readonly string[]).indexOf(field);
  return at === -1 ? FIELD_ORDER.length : at;
};

/**
 * The first issue in reading order.
 *
 * Strict `<` keeps the earlier entry on a tie, so two issues on one field stay in the order the
 * validator produced them and the answer is stable across renders.
 */
export function firstIssue(issues: ValidationIssue[]): ValidationIssue | null {
  let best: ValidationIssue | null = null;
  for (const issue of issues) {
    if (!best || rank(issue.field) < rank(best.field)) best = issue;
  }
  return best;
}

export type DetailInput = {
  steps: number;
  cfgScale: number;
  seed: string;
  sampling: string | null;
  scheduler: string | null;
  cfgEditable: boolean;
  samplingEditable: boolean;
  schedulerEditable: boolean;
};

/**
 * The line the folded 세부 생성 설정 shows.
 *
 * Derived from `settings`, never from the selected preset. A preset fills Steps and CFG when
 * it is pressed and the user may then edit either one; a summary that read `preset.steps` would
 * describe the button instead of the request. `cfgEditable` is part of the derivation for the
 * same reason the body checks it: `cfg_scale` is only sent when the model lets it be edited, so
 * a summary claiming a CFG the request omits would be worse than no summary at all.
 */
export function detailSummary(input: DetailInput): { parts: string[]; text: string } {
  const seed = input.seed.trim();
  const parts = [
    `Steps ${input.steps}`,
    input.cfgEditable ? `CFG ${input.cfgScale}` : "CFG 모델 고정",
    // An empty box sends `Number("")` = 0, so say 0 rather than implying "random".
    `Seed ${seed === "" ? "0" : seed}`,
  ];
  if (input.samplingEditable && input.sampling) parts.push(`Sampler ${input.sampling}`);
  if (input.schedulerEditable && input.scheduler) parts.push(`Scheduler ${input.scheduler}`);
  return { parts, text: parts.join(" · ") };
}
