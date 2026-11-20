import type { PromptComposition } from "../api";

export type ValidationIssue = { field: string; message: string };
export const characterCount = (text: string) => Array.from(text).length;
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

// Python str.strip includes these characters; JS trim differs for U+0085/U+FEFF.
// eslint-disable-next-line no-control-regex -- Match Python whitespace, including control separators.
const pythonWhitespace = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;
export function validateText(text: string, field: string, limit: number, required = false): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const count = characterCount(text);
  if (count > limit) issues.push({ field, message: `${count}/${limit}자: 내용을 줄여 주세요.` });
  if (required && pythonWhitespace.test(text)) issues.push({ field, message: "공백이 아닌 내용을 입력하세요." });
  if (text.includes("\0")) issues.push({ field, message: "NUL 문자를 제거하세요." });
  if (/[\uD800-\uDFFF]/u.test(text)) issues.push({ field, message: "손상된 유니코드 문자를 제거하세요." });
  return issues;
}

// Match Pydantic model_dump defaults before json.dumps(ensure_ascii=False,
// separators=(',', ':')). Missing unresolved IDs become null on the server.
//
// TRANS01 §2.4: `remainder` is only normalized when a v2 composition carries one.
// A v1 snapshot must not gain the key here either — this function feeds the byte
// count that decides whether the snapshot can be saved, and adding an empty array
// would measure a body the server would reject as `extra_forbidden`.
export function normalizedComposition(composition: PromptComposition) {
  const remainder = composition.remainder === undefined ? {} : {
    remainder: composition.remainder.map((item) => ({ ...item })),
  };
  return { ...composition, selections: composition.selections.map((item) => ({ ...item, rendered: item.rendered ?? null })),
    free_text_ko: composition.free_text_ko ?? "", draft_prompt: composition.draft_prompt ?? "",
    unresolved: (composition.unresolved ?? []).map((item) => ({ ...item, id: item.id ?? null })), ...remainder };
}
export function compositionBytes(composition: PromptComposition): number {
  return utf8Bytes(JSON.stringify(normalizedComposition(composition)));
}

export function validateComposition(c: PromptComposition, family: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const text = (value: string, field: string, limit: number, required = false) => {
    issues.push(...validateText(value, field, limit));
    if (required && !value.length) add(field, "빈 값은 사용할 수 없습니다.");
  };
  // TRANS05: the server accepts v1 and v2 simultaneously and advertises both, so the
  // client must not reject a v2 snapshot it just built. A v2 body without `remainder`
  // is a server default; a v1 body *with* one is `extra_forbidden`, so the key and the
  // version have to agree here too.
  if (c.schema_version !== 1 && c.schema_version !== 2) add("composition", "지원하는 구성 스키마는 v1, v2입니다.");
  if (c.schema_version === 1 && c.remainder !== undefined) add("composition", "v1 구성에는 번역문을 넣을 수 없습니다.");
  if (c.schema_version === 2 && (c.remainder?.length ?? 0) > 8) add("remainder", `${c.remainder?.length}/8개: 번역문을 줄여 주세요.`);
  if (c.target_family !== family) add("composition", "모델 계열이 다릅니다. 대상 모델에서 초안을 다시 만들고 적용하세요.");
  text(c.compiler_version, "composition", 100, true);
  text(c.target_family, "composition", 100, true);
  text(c.free_text_ko, "free_text_ko", 4000);
  text(c.draft_prompt, "draft_prompt", 8000);
  if (c.selections.length > 100) add("selections", `${c.selections.length}/100개: 선택을 줄여 주세요.`);
  const ids = new Set<string>();
  for (const item of c.selections) {
    if (ids.has(item.id)) add("selections", `중복 ID ${item.id}: 항목을 다시 선택하세요.`);
    ids.add(item.id);
    for (const [value, limit] of [[item.id, 100], [item.category, 100], [item.label_ko, 300], [item.dictionary_version, 100]] as const) text(value, "selections", limit, true);
    if (item.mapping_status === "mapped") {
      if (item.rendered == null) add("selections", `${item.label_ko}: 표현이 없습니다. 다시 선택하세요.`);
      else issues.push(...validateText(item.rendered, "selections", 300, true));
    } else if (item.mapping_status !== "unavailable" || item.rendered != null) {
      add("selections", `${item.label_ko}: 매핑 상태와 표현이 맞지 않습니다. 다시 선택하세요.`);
    }
  }
  if (c.unresolved.length > 101) add("unresolved", `${c.unresolved.length}/101개: 미변환 항목을 줄여 주세요.`);
  for (const item of c.unresolved) {
    if (!["selection", "free_text"].includes(item.kind)) add("unresolved", "잘못된 미변환 항목 종류입니다.");
    text(item.text, "unresolved", 4000, true);
    if (item.id != null) text(item.id, "unresolved", 100);
  }
  const bytes = compositionBytes(c);
  if (bytes > 32768) add("composition", `${bytes}/32768바이트: 선택 또는 추가 설명을 줄여 초안을 다시 적용하세요.`);
  // TRANS01 §2/§4: every field here is mirrored from `CompositionRemainder`, including
  // the 8-character `proposal_id` minimum and the exact `accepted_at` pattern. A miss
  // would only surface as a 422 after the user had already pressed 생성.
  for (const item of c.remainder ?? []) {
    text(item.source_ko, "remainder", 200, true);
    text(item.suggested_en, "remainder", 200, true);
    text(item.proposal_model, "remainder", 200, true);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(item.proposal_id)) add("remainder", "번역 제안 출처가 올바르지 않습니다. 번역을 다시 요청하세요.");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(item.accepted_at)) add("remainder", "번역 시각 형식이 올바르지 않습니다. 번역을 다시 포함하세요.");
  }
  return issues;
}

export function validateSubmission(body: Record<string, unknown>, family: string, maxBodyBytes: number | null): ValidationIssue[] {
  const issues = validateText(String(body.prompt ?? ""), "prompt", 8000, true);
  issues.push(...validateText(String(body.negative_prompt ?? ""), "negative_prompt", 4000));
  if (body.prompt_composition) issues.push(...validateComposition(body.prompt_composition as PromptComposition, family));
  const bytes = utf8Bytes(JSON.stringify(body));
  if (maxBodyBytes !== null && bytes > maxBodyBytes) issues.push({ field: "request", message: `${bytes}/${maxBodyBytes}바이트: 전체 요청이 너무 큽니다. 프롬프트나 구성을 줄여 주세요.` });
  return issues;
}
