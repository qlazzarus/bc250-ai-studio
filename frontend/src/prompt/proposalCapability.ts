/**
 * Capability gate for AI proposals (LLM-I04).
 *
 * `GET /system/capabilities` omits `prompt_proposals` when the server cannot serve
 * one (fake engine, no gate, or no `llm_model`). Absence is a normal answer, so the
 * composer keeps the rule-based suggestions and says so in one sentence; it must
 * never show a disabled AI button that looks broken.
 *
 * A dictionary mismatch is also a "do not call" state: the server validates IDs
 * against its own mirror and answers `stale_dictionary`, so asking would produce a
 * failure the user cannot act on.
 */

export const PROPOSAL_SCHEMA_VERSION = 1;
export const DEFAULT_TIMEOUT_MS = 20_000;
/** The server's own budget is 20 s; the browser waits a little longer (C02-2). */
export const TIMEOUT_SLACK_MS = 5_000;

export type ProposalSupport = "supported" | "absent" | "unsupported_schema" | "stale_dictionary";

export type ProposalCapability = {
  supported: boolean;
  support: ProposalSupport;
  /** Advertised dictionary version, or `null` when it was not sent. */
  dictionaryVersion: string | null;
  /** Client-side abort budget, derived from the advertised server timeout. */
  timeoutMs: number;
};

export const UNSUPPORTED: ProposalCapability = {
  supported: false,
  support: "absent",
  dictionaryVersion: null,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

/** The raw capability object as it appears in `system/capabilities`. */
export type RawProposalCapability = {
  schema_versions?: unknown;
  dictionary_version?: unknown;
  timeout_ms?: unknown;
  max_response_bytes?: unknown;
};

export function readProposalCapability(
  raw: RawProposalCapability | null | undefined,
  localDictionaryVersion: string,
): ProposalCapability {
  if (!raw || typeof raw !== "object") return UNSUPPORTED;
  const versions = Array.isArray(raw.schema_versions) ? raw.schema_versions : [];
  if (!versions.includes(PROPOSAL_SCHEMA_VERSION)) {
    return { ...UNSUPPORTED, support: "unsupported_schema" };
  }
  const advertised = typeof raw.dictionary_version === "string" ? raw.dictionary_version : null;
  const timeoutMs = typeof raw.timeout_ms === "number" && Number.isFinite(raw.timeout_ms)
    && raw.timeout_ms >= 1_000 && raw.timeout_ms <= 60_000
    ? raw.timeout_ms + TIMEOUT_SLACK_MS
    : DEFAULT_TIMEOUT_MS + TIMEOUT_SLACK_MS;
  if (advertised === null || advertised !== localDictionaryVersion) {
    return { supported: false, support: "stale_dictionary", dictionaryVersion: advertised, timeoutMs };
  }
  return { supported: true, support: "supported", dictionaryVersion: advertised, timeoutMs };
}

/**
 * The button label from the target screen spec: the AI wording appears only once
 * the capability is confirmed, so an unsupported server never advertises a feature
 * it does not have.
 */
export function proposalActionLabel(capability: ProposalCapability): string {
  return capability.supported ? "장면 정리하기" : "사전 항목 제안";
}

/** One sentence explaining what the user gets instead. `null` when AI is available. */
export function proposalFallbackNotice(capability: ProposalCapability): string | null {
  switch (capability.support) {
    case "supported":
      return null;
    case "stale_dictionary":
      return "서버 사전 버전이 화면과 달라 AI 제안을 쓰지 않습니다. 새로고침하면 다시 확인합니다. 지금은 원문에서 사전 항목만 찾습니다.";
    case "unsupported_schema":
      return "이 서버의 AI 제안 형식이 화면과 다릅니다. 지금은 원문에서 사전 항목만 찾습니다.";
    case "absent":
      return "이 서버에서는 AI 제안을 사용할 수 없습니다. 지금은 원문에서 사전 항목만 찾습니다.";
  }
}
