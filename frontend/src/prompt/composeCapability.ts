/**
 * UCP05: capability gate for the integrated compose path.
 *
 * `GET /system/capabilities` advertises `prompt_compose` as its own key, separate from
 * `prompt_proposals` (§5). A server that only has the older key must be read as "the
 * integrated path is unavailable" — assuming support because a neighbouring key exists is
 * the mistake the contract calls out by name. Absence is therefore a normal answer, and
 * the rule-based composer has to keep working without it.
 *
 * Three independent facts are checked, because each one has a different remedy:
 *
 * 1. **schema** — the reply shape this build can parse. No match: nothing can be done
 *    from the browser, so the integrated button is not offered.
 * 2. **dictionary** — the server validates IDs against its own mirror and answers
 *    `409 stale_dictionary`, so a mismatch is a "do not call" state until a reload.
 * 3. **profile** — the per-family output profile version. A family missing from the map
 *    means this build has no profile for it, which the server treats as a 422.
 *
 * The timeout is the server's budget plus slack, derived the same way as the proposal
 * gate (`TIMEOUT_SLACK_MS`) instead of a second hand-written constant.
 */

import { TIMEOUT_SLACK_MS } from "./proposalCapability.ts";

export const COMPOSE_SCHEMA_VERSION = 1;
export const DEFAULT_COMPOSE_TIMEOUT_MS = 65_000;
export const COMPOSE_MAX_CANDIDATES = 3;

export type ComposeSupport =
  | "supported"
  | "absent"
  | "unsupported_schema"
  | "stale_dictionary"
  | "unknown_family";

export type ComposeCapability = {
  supported: boolean;
  support: ComposeSupport;
  /** Advertised dictionary version, or `null` when it was not sent. */
  dictionaryVersion: string | null;
  /** Advertised profile version for the target family, `null` when unnamed. */
  profileVersion: number | null;
  /** Client-side abort budget, derived from the advertised server timeout. */
  timeoutMs: number;
  maxCandidates: number;
};

export const COMPOSE_UNSUPPORTED: ComposeCapability = {
  supported: false,
  support: "absent",
  dictionaryVersion: null,
  profileVersion: null,
  timeoutMs: DEFAULT_COMPOSE_TIMEOUT_MS,
  maxCandidates: COMPOSE_MAX_CANDIDATES,
};

/** The raw `prompt_compose` object as it appears in `system/capabilities`. */
export type RawComposeCapability = {
  schema_versions?: unknown;
  dictionary_version?: unknown;
  output_profile_versions?: unknown;
  timeout_ms?: unknown;
  max_candidates?: unknown;
};

const positiveInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;

/**
 * Read the advertised block for one model family.
 *
 * `family` is required rather than optional: the profile version is per family, so a
 * capability read without a target cannot answer "can this model be composed for".
 */
export function readComposeCapability(
  raw: RawComposeCapability | null | undefined,
  localDictionaryVersion: string,
  family: string,
): ComposeCapability {
  if (!raw || typeof raw !== "object") return COMPOSE_UNSUPPORTED;
  const versions = Array.isArray(raw.schema_versions) ? raw.schema_versions : [];
  if (!versions.includes(COMPOSE_SCHEMA_VERSION)) {
    return { ...COMPOSE_UNSUPPORTED, support: "unsupported_schema" };
  }
  const advertised = typeof raw.dictionary_version === "string" ? raw.dictionary_version : null;
  const timeout = positiveInt(raw.timeout_ms);
  const timeoutMs = timeout !== null && timeout >= 1_000 && timeout <= 120_000
    ? timeout + TIMEOUT_SLACK_MS
    : DEFAULT_COMPOSE_TIMEOUT_MS;
  const maxCandidates = positiveInt(raw.max_candidates) ?? COMPOSE_MAX_CANDIDATES;
  const profiles = raw.output_profile_versions;
  const profileVersion = profiles && typeof profiles === "object"
    ? positiveInt((profiles as Record<string, unknown>)[family])
    : null;
  if (advertised === null || advertised !== localDictionaryVersion) {
    return { supported: false, support: "stale_dictionary", dictionaryVersion: advertised,
      profileVersion, timeoutMs, maxCandidates };
  }
  if (profileVersion === null) {
    // The family is in the registry but this build has no output profile for it, which
    // the server refuses before the provider call. Asking would spend a round trip to
    // learn what the capability already said.
    return { supported: false, support: "unknown_family", dictionaryVersion: advertised,
      profileVersion: null, timeoutMs, maxCandidates };
  }
  return { supported: true, support: "supported", dictionaryVersion: advertised,
    profileVersion, timeoutMs, maxCandidates };
}

/** The one sentence explaining what the user gets instead. `null` when available. */
export function composeFallbackNotice(capability: ComposeCapability): string | null {
  switch (capability.support) {
    case "supported":
      return null;
    case "stale_dictionary":
      return "서버 사전 버전이 화면과 달라 통합 생성을 쓰지 않습니다. 새로고침하면 다시 확인합니다. 지금은 사전에서 직접 고르고 초안을 적용할 수 있습니다.";
    case "unknown_family":
      return "이 모델 계열의 출력 프로필을 서버가 광고하지 않아 통합 생성을 쓸 수 없습니다. 사전에서 직접 고르고 초안을 적용하세요.";
    case "unsupported_schema":
      return "이 서버의 통합 생성 형식이 화면과 다릅니다. 사전에서 직접 고르고 초안을 적용하세요.";
    case "absent":
      return "이 서버에서는 통합 생성을 사용할 수 없습니다. 사전에서 직접 고르고 초안을 적용하세요.";
  }
}
