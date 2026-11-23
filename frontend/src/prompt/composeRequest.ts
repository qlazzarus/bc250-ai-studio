/**
 * UCP05: the wire boundary for `POST /api/v1/prompt/compose`.
 *
 * Everything here is a pure function over the browser's state, so the mapping between the
 * screen and the contract is testable without React or `fetch`. Three jobs:
 *
 * 1. **Build a valid body** — or refuse with a reason. The server returns `422` for a
 *    body it considers malformed, and a `409` for a fingerprint that disagrees, so a
 *    client that sends a partly-filled form produces an error the user cannot act on.
 *    Building it here means the missing field is named before anything is sent.
 * 2. **Parse a reply** into the session's `ComposeResult`. The reply is validated, not
 *    trusted: a malformed candidate or a question with no options makes the whole reply
 *    unusable, because half a reply would show a scene the server never claimed.
 * 3. **Map a failure** to the session's `ComposeFailure` vocabulary.
 *
 * `selections` is normalised on the way out: the server rejects an `excluded` chip that
 * also carries `pinned`/`entity_id` (`check_source`), and this module is the only place
 * that rule is applied so no handler can forget it.
 */

import {
  MAX_CHOICES, type ComposeEdit, type EditSelection, parseScene,
} from "./structuredScene.ts";
import type {
  ComposeCandidate, ComposeClarification, ComposeFailure, ComposeResult, ComposeTarget,
  TokenUsage,
} from "./composeSession";
import { composeRevisions } from "./composeSession.ts";

/** The wire selection: `pinned`/`entity_id` omitted for a veto. */
export type WireSelection = {
  id: string;
  source: EditSelection["source"];
  pinned?: boolean;
  entity_id?: string;
};

export type ComposeBody = {
  schema_version: 1;
  request_id: string;
  input_revision: string;
  dictionary_version: string;
  target_model_id: string;
  target_family: string;
  profile_version: number;
  candidate_count: number;
  brief_ko: string;
  selections: WireSelection[];
  clarification_choices: { question_id: string; option_id: string }[];
};

/**
 * One selection as the server expects it.
 *
 * An excluded chip is a veto pure and simple: sending `pinned: false` or
 * `entity_id: null` alongside it is a `422` on the server, not a harmless extra. The
 * `source` is always sent explicitly — the field's absence means `auto`, which would
 * silently downgrade a manual pick.
 */
export function wireSelection(item: EditSelection): WireSelection {
  if (item.source === "excluded") return { id: item.id, source: "excluded" };
  const out: WireSelection = { id: item.id, source: item.source, pinned: item.pinned };
  if (item.entityId !== null) out.entity_id = item.entityId;
  return out;
}

export type BuildResult =
  | { ok: true; body: ComposeBody }
  | { ok: false; failure: ComposeFailure; message: string; detail: string | null };

/**
 * Build the body, or say what is missing.
 *
 * The order follows the user's attention: an unusable target first (nothing else can be
 * checked), then "nothing to send", then the limits. Each failure carries a message that
 * names the field, because this text ends up in the failure alert.
 */
export function buildComposeBody(input: {
  edit: ComposeEdit;
  target: ComposeTarget;
  requestId: string;
  candidateCount: number;
}): BuildResult {
  const { edit, target, requestId, candidateCount } = input;
  if (!target.modelId || !target.family) {
    return { ok: false, failure: "build_failed", detail: "target",
      message: "대상 모델을 먼저 선택하세요." };
  }
  if (target.profileVersion < 1) {
    return { ok: false, failure: "build_failed", detail: "profile",
      message: "이 모델의 출력 프로필을 확인할 수 없습니다. 새로고침 후 다시 시도하세요." };
  }
  const chosen = edit.selections.filter((item) => item.source !== "excluded");
  if (!edit.briefKo.trim() && chosen.length === 0) {
    return { ok: false, failure: "build_failed", detail: "empty",
      message: "한글 장면을 입력하거나 사전에서 항목을 하나 이상 고르세요." };
  }
  // `canCompose` is the same limits check the UI uses for its disabled state; calling it
  // is not enough here because a paste can exceed a limit without passing a keystroke.
  if (edit.briefKo.length > 4_000) {
    return { ok: false, failure: "build_failed", detail: "brief_ko",
      message: "한글 장면이 4,000자를 넘습니다. 줄인 뒤 다시 생성하세요." };
  }
  if (edit.selections.length > 100) {
    return { ok: false, failure: "build_failed", detail: "selections",
      message: "선택 항목이 100개를 넘습니다. 일부를 제외한 뒤 다시 생성하세요." };
  }
  if (edit.choices.length > MAX_CHOICES) {
    return { ok: false, failure: "build_failed", detail: "choices",
      message: "확인 응답이 너무 많습니다. 다시 생성해 질문을 새로 받으세요." };
  }
  const revisions = composeRevisions(edit, target);
  return { ok: true, body: {
    schema_version: 1,
    request_id: requestId,
    input_revision: revisions.input,
    dictionary_version: target.dictionaryVersion,
    target_model_id: target.modelId,
    target_family: target.family,
    profile_version: target.profileVersion,
    candidate_count: Math.min(3, Math.max(1, Math.trunc(candidateCount) || 3)),
    brief_ko: edit.briefKo,
    selections: edit.selections.map(wireSelection),
    clarification_choices: edit.choices.map((item) => ({
      question_id: item.questionId, option_id: item.optionId })),
  } };
}


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const optionalStr = (value: unknown): string | null =>
  (typeof value === "string" && value.length > 0 ? value : null);
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type ParseResult =
  | { ok: true; result: ComposeResult }
  | { ok: false; failure: ComposeFailure; message: string; detail: string | null };

/** Codes this module maps to a session failure; the rest become `invalid_reply`. */
const FAILURE_BY_CODE: Record<string, ComposeFailure> = {
  gpu_unavailable: "provider_error",
  admission_paused: "provider_error",
  gate_unreachable: "provider_error",
  upstream_status: "provider_error",
  timeout: "timed_out",
  busy: "provider_error",
  not_configured: "provider_error",
  stale_dictionary: "conflict",
  stale_profile: "conflict",
  stale_clarification: "conflict",
  model_family_mismatch: "conflict",
};

/**
 * A server failure body → the session's vocabulary.
 *
 * The route sends `{status: "error"|"unavailable", why, message, detail?}`. `why` decides
 * the category; the *server's* `message` is deliberately not used as the display text,
 * because it is written for operators (the route's `422` messages embed pydantic field
 * paths). `detail` is passed through untouched and the alert module decides whether it is
 * safe to render.
 */
export function failureFromBody(body: unknown): ParseResult {
  const record = isRecord(body) ? body : {};
  const why = str(record.why);
  return { ok: false, failure: FAILURE_BY_CODE[why] ?? "provider_error",
    message: "", detail: optionalStr(record.detail) };
}

function parseCandidate(value: unknown): ComposeCandidate | { error: string } {
  if (!isRecord(value)) return { error: "candidate is not an object" };
  if (!nonEmpty(value.candidate_id) || !nonEmpty(value.title_ko)
      || !nonEmpty(value.difference_ko) || !nonEmpty(value.positive_prompt)) {
    return { error: "candidate is missing a required field" };
  }
  return {
    candidateId: value.candidate_id,
    titleKo: value.title_ko,
    differenceKo: value.difference_ko,
    positivePrompt: value.positive_prompt,
    negativePrompt: optionalStr(value.negative_prompt),
    preservedKo: list(value.preserved_ko).filter(nonEmpty),
  };
}

function parseClarification(value: unknown): ComposeClarification | { error: string } {
  if (!isRecord(value)) return { error: "clarification is not an object" };
  if (!nonEmpty(value.question_id) || !nonEmpty(value.question_ko)) {
    return { error: "clarification is missing a question" };
  }
  const options: ComposeClarification["options"] = [];
  for (const option of list(value.options)) {
    if (!isRecord(option) || !nonEmpty(option.option_id) || !nonEmpty(option.label_ko)) {
      return { error: "clarification option is malformed" };
    }
    options.push({ optionId: option.option_id, labelKo: option.label_ko });
  }
  // A question with no options is not answerable, and answering is the only way forward
  // from `needs_clarification`. Treating it as a question would trap the user.
  if (options.length === 0) return { error: "clarification has no options" };
  return {
    questionId: value.question_id,
    questionKo: value.question_ko,
    why: (["actor_unknown", "polarity_conflict", "model_mismatch", "dictionary_missing"]
      .includes(str(value.why)) ? value.why : "actor_unknown") as ComposeClarification["why"],
    options,
  };
}

/**
 * One `selections` entry of a reply.
 *
 * The server sends the *reconciled* list: its own `auto` reading merged with the user's
 * `manual`/`pinned`/`excluded` facts (§4 one-way trust). It always sends `source`, and
 * `pinned` is required for a chosen row and forbidden for a veto — so a row that breaks
 * those rules is a malformed reply, not something to paper over.
 *
 * Returning `null` means "malformed", which rejects the whole reply: adopting the rest
 * would show a chip list the server never claimed.
 */
function parseSelection(value: unknown): EditSelection | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value.id)) return null;
  const source = str(value.source);
  if (source !== "auto" && source !== "manual" && source !== "excluded") return null;
  if (source === "excluded") {
    // A veto carries neither flag; accepting them would invent a pin the spec forbids.
    if (value.pinned !== undefined && value.pinned !== null) return null;
    if (value.entity_id !== undefined && value.entity_id !== null) return null;
    return { id: value.id, source: "excluded", pinned: false, entityId: null };
  }
  if (typeof value.pinned !== "boolean") return null;
  const entityId = optionalStr(value.entity_id);
  return { id: value.id, source, pinned: value.pinned, entityId };
}

const tokenCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;

function parseTokens(value: unknown, cutShort: boolean): TokenUsage {
  const provider = isRecord(value) ? value : {};
  return {
    promptTokens: tokenCount(provider.prompt_tokens),
    reasoningTokens: tokenCount(provider.reasoning_tokens),
    outputTokens: tokenCount(provider.output_tokens),
    truncated: cutShort || str(provider.finish_reason) === "length",
  };
}


/**
 * Parse a `200` reply into the session's `ComposeResult`.
 *
 * `revisions` come from the caller rather than the body. The reply echoes
 * `input_revision`, but `settleComposition` compares the reply against the revisions that
 * were *sent*, so re-deriving them from the echo would make the comparison vacuous.
 * `requestId` does come from the body, because matching a late reply to its own request is
 * the whole reason it is echoed.
 *
 * A malformed part rejects the whole reply. Keeping the parseable half would show a scene
 * or a candidate list the server never claimed to have validated.
 */
export function parseComposeReply(
  body: unknown,
  input: { requestId: string; revisions: ComposeResult["revisions"] },
): ParseResult {
  if (!isRecord(body)) {
    return { ok: false, failure: "invalid_reply", message: "", detail: "reply is not an object" };
  }
  const status = str(body.status);
  if (status === "unavailable" || status === "error") return failureFromBody(body);
  if (status !== "ready" && status !== "needs_clarification") {
    return { ok: false, failure: "invalid_reply", message: "", detail: "unknown status" };
  }
  if (!nonEmpty(body.result_id) || !nonEmpty(body.request_id)) {
    return { ok: false, failure: "invalid_reply", message: "", detail: "reply has no ids" };
  }
  const parsed = parseScene(body.scene);
  if ("error" in parsed) {
    return { ok: false, failure: "invalid_reply", message: "", detail: parsed.error };
  }
  const candidates: ComposeCandidate[] = [];
  for (const item of list(body.candidates)) {
    const candidate = parseCandidate(item);
    if ("error" in candidate) {
      return { ok: false, failure: "invalid_reply", message: "", detail: candidate.error };
    }
    candidates.push(candidate);
  }
  const questions: ComposeClarification[] = [];
  for (const item of list(body.clarifications)) {
    const question = parseClarification(item);
    if ("error" in question) {
      return { ok: false, failure: "invalid_reply", message: "", detail: question.error };
    }
    questions.push(question);
  }
  const selections: EditSelection[] = [];
  for (const item of list(body.selections)) {
    const selection = parseSelection(item);
    if (selection === null) {
      return { ok: false, failure: "invalid_reply", message: "",
        detail: "selection is malformed" };
    }
    selections.push(selection);
  }
  // §5: the two states are mutually exclusive. A reply with both leaves no defined button
  // to press, so it is refused rather than shown.
  if (status === "ready" && questions.length > 0) {
    return { ok: false, failure: "invalid_reply", message: "", detail: "ready carries questions" };
  }
  if (status === "needs_clarification" && candidates.length > 0) {
    return { ok: false, failure: "invalid_reply", message: "",
      detail: "clarification carries candidates" };
  }
  if (status === "needs_clarification" && questions.length === 0) {
    return { ok: false, failure: "invalid_reply", message: "",
      detail: "clarification carries nothing" };
  }
  if (status === "ready" && candidates.length === 0) {
    // An empty `ready` reads as "your scene needs no candidates". Only `unavailable` may
    // mean that, which the server's own model also enforces.
    return { ok: false, failure: "invalid_reply", message: "",
      detail: "ready carries no candidates" };
  }
  return { ok: true, result: {
    resultId: body.result_id,
    requestId: body.request_id,
    revisions: input.revisions,
    summaryKo: str(body.summary_ko),
    scene: parsed.scene,
    selections,
    candidates,
    questions,
    warnings: list(body.warnings).filter(nonEmpty),
    snapshotTrim: list(body.snapshot_trim).filter(nonEmpty),
    providerModel: isRecord(body.provider) ? optionalStr(body.provider.model) : null,
    tokens: parseTokens(body.provider, body.cut_short === true),
  } };
}
