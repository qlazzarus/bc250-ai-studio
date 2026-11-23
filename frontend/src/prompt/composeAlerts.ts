/**
 * UCP05: the three alert categories, kept apart on purpose.
 *
 * The user's requirement is that these are never merged into one red box, because each
 * one calls for a different action:
 *
 * 1. **advisory** — the candidates are usable; something about them is worth knowing
 *    (sd15 token window, a weighting syntax the engine may not honour). Nothing is
 *    missing and nothing is blocked.
 * 2. **reduced** — the list is *shorter than requested*. Still usable, but the user has
 *    to know why, or the short list reads as "the model had nothing to say".
 * 3. **failure** — the request produced nothing usable. This is the only category that
 *    takes the candidates away.
 *
 * Two rules from §5 are enforced here rather than in a component:
 *
 * - A warning code the server never explains is *shown*, not silently dropped. Unknown
 *   codes fall back to a neutral sentence plus the code, because a new server code must
 *   not vanish behind a `default: return null`.
 * - `detail` is a server byte/shape string. It is never rendered raw: only mapped,
 *   known details (the three the route emits) become user-facing text. Anything else is
 *   reported as an opaque addition and the raw value is never interpolated. This is what
 *   keeps provider internals and stack-shaped text off the screen.
 */

import type { ComposeFailure } from "./composeSession";

export type AlertTone = "info" | "caution" | "error";

export type ComposeAlert = {
  /** Stable key for React and for tests. */
  key: string;
  category: "advisory" | "reduced" | "failure";
  tone: AlertTone;
  title: string;
  message: string;
};

/** Warning codes this build can explain. Unknown ones still reach the screen. */
const WARNING_COPY: Record<string, { title: string; message: string }> = {
  profile_token_window: {
    title: "토큰 길이 안내",
    message: "이 계열의 텍스트 인코더 창을 넘는 후보가 있습니다. 잘리지 않고 경고만 표시합니다. "
      + "sd.cpp는 긴 프롬프트를 나눠 처리하므로 품질이 달라질 수 있습니다.",
  },
  profile_weighting_syntax: {
    title: "가중치 문법 포함",
    message: "후보에 `(단어:1.2)` 또는 `<lora:...>` 같은 가중치 문법이 있습니다. "
      + "이 엔진이 그 문법을 그대로 해석한다는 보장이 없으므로 적용 전에 확인하세요.",
  },
  duplicate_candidates: {
    title: "중복 후보 제거",
    message: "같은 영어 본문의 후보가 있어 하나만 남겼습니다. 내용이 거부된 것이 아니라 "
      + "모델이 같은 문장을 반복했습니다.",
  },
  candidates_reduced: {
    title: "후보 수가 줄었습니다",
    message: "요청한 후보 수보다 적게 돌아왔습니다. 형식·글자 수 검사를 통과하지 못한 후보는 "
      + "자르지 않고 제외했습니다.",
  },
  negative_unsupported: {
    title: "Negative prompt 미지원",
    message: "이 모델은 negative prompt를 받지 않아 후보에서 그 필드를 뺐습니다. "
      + "긍정 프롬프트만 적용됩니다.",
  },
  negative_requires_cfg: {
    title: "Negative prompt 조건 미충족",
    message: "이 모델은 특정 CFG에서만 negative prompt를 받습니다. CFG를 바꾸지 않고 "
      + "필드를 뺐습니다. 적용하면 긍정 프롬프트만 들어갑니다.",
  },
  unknown_ids_dropped: {
    title: "확인되지 않은 항목 제외",
    message: "서버 사전에서 검증되지 않은 선택 항목이 결과에서 빠졌습니다. 사전에서 다시 고르세요.",
  },
  dictionary_truncated: {
    title: "사전 일부만 사용",
    message: "사전이 커서 요청에 일부 항목만 전달했습니다. 이번 결과에 영향을 줄 수 있습니다.",
  },
};

/** Codes that mean the list is shorter than requested, not that a candidate is odd. */
export const REDUCING_CODES = ["candidates_reduced", "duplicate_candidates"] as const;

export function warningAlert(code: string, index: number): ComposeAlert {
  const known = WARNING_COPY[code];
  const reducing = (REDUCING_CODES as readonly string[]).includes(code);
  return {
    key: `warn-${code}-${index}`,
    category: reducing ? "reduced" : "advisory",
    tone: "caution",
    title: known?.title ?? "알 수 없는 경고",
    // An unexplained code is still a fact the server reported, so it is shown with its
    // code instead of being filtered out.
    message: known?.message ?? `서버가 이 화면이 설명하지 못하는 경고(${code})를 보냈습니다.`,
  };
}

/**
 * Order the alerts by *category first*, then by the server's order within a category.
 *
 * The reported concern is that a reply can carry both `duplicate_candidates` and
 * `candidates_reduced`, and the UI should not depend on which the server happened to list
 * first. `category` is derived from the code itself (`REDUCING_CODES`), not from position,
 * so the two are always rendered as the same kind of message. Sorting is stable, so the
 * server's own ordering — which encodes its priority — survives inside each group.
 *
 * The load-bearing rule is that `reduced` outranks `advisory`: "the list is short" is a fact
 * about what the user did *not* get, and an advisory about prompt length must not push it
 * down the screen.
 */
const CATEGORY_RANK: Record<ComposeAlert["category"], number> = {
  failure: 0, reduced: 1, advisory: 2,
};

export const warningAlerts = (codes: readonly string[]): ComposeAlert[] =>
  codes
    .map((code, index) => ({ alert: warningAlert(code, index), index }))
    .sort((a, b) => (CATEGORY_RANK[a.alert.category] - CATEGORY_RANK[b.alert.category])
      || (a.index - b.index))
    .map((entry) => entry.alert);


/**
 * The `detail` values the compose route actually emits, mapped to plain Korean.
 *
 * The route's own table (`DETAIL_MESSAGES` in `api/compose.py`) is the source. Only these
 * three are known to be user-facing; everything else is treated as opaque.
 */
const DETAIL_COPY: Record<string, string> = {
  recovery_required: "GPU 복구 확인이 필요합니다.",
  image_running: "이미지 생성이 끝난 뒤 다시 시도하세요.",
  manual_approval: "관리자 승인 후 사용할 수 있습니다.",
};

const FAILURE_COPY: Record<ComposeFailure, { title: string; message: string }> = {
  truncated: { title: "응답이 잘렸습니다",
    message: "모델 출력이 토큰 한도에서 끝나 일부 후보를 받지 못했습니다. 다시 생성하면 나아질 수 있습니다." },
  partial: { title: "일부만 사용할 수 있습니다",
    message: "받은 후보 중 일부만 검사를 통과했습니다. 남은 후보는 그대로 적용할 수 있습니다." },
  timed_out: { title: "응답 시간 초과",
    message: "브라우저가 기다린 시간을 넘겼습니다. 서버는 계속 처리 중일 수 있으니 잠시 후 다시 생성하세요." },
  provider_error: { title: "모델 호출 실패",
    message: "장면을 해석하는 모델 호출이 실패했습니다. 다시 생성해 보세요." },
  invalid_reply: { title: "응답 형식 오류",
    message: "서버가 계약에 맞지 않는 응답을 받아 적용하지 않았습니다. 같은 입력으로 다시 시도해도 결과가 같을 수 있습니다." },
  conflict: { title: "요청이 만료되었습니다",
    message: "화면의 사전·프로필·입력 중 하나가 서버와 달라 요청을 받지 않았습니다. 다시 생성하세요." },
  expired: { title: "이전 결과 만료",
    message: "모델이나 출력 프로필이 바뀌어 이 결과를 적용할 수 없습니다. 다시 생성하세요." },
  build_failed: { title: "요청을 보낼 수 없습니다",
    message: "입력이나 대상 모델이 요청 조건을 만족하지 않아 아무것도 보내지 않았습니다. 안내된 항목을 고치세요." },
};

/**
 * One failure alert.
 *
 * `message` is this module's Korean copy, not the server's English/diagnostic string.
 * The raw `detail` is consulted only through `DETAIL_COPY`; an unknown one adds a generic
 * sentence so the user knows *something* specific was reported without seeing it.
 */
export function failureAlert(
  failure: ComposeFailure,
  detail: string | null,
  override?: string,
): ComposeAlert {
  const copy = FAILURE_COPY[failure];
  const knownDetail = detail !== null && Object.hasOwn(DETAIL_COPY, detail)
    ? DETAIL_COPY[detail] : undefined;
  const parts = [override ?? copy.message];
  if (knownDetail) parts.push(knownDetail);
  else if (detail !== null) {
    // Deliberately no `detail` interpolation: it can carry field paths or provider text.
    parts.push("서버가 추가 사유를 보고했지만 이 화면에서는 표시하지 않습니다.");
  }
  return { key: `failure-${failure}`, category: "failure", tone: "error",
    title: copy.title, message: parts.join(" ") };
}

/** `true` for a `detail` value this build can render. Used by tests and diagnostics. */
export const isKnownDetail = (detail: string | null): boolean =>
  detail !== null && Object.hasOwn(DETAIL_COPY, detail);
