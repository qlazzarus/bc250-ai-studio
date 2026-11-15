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
export function normalizedComposition(composition: PromptComposition) {
  return { ...composition, selections: composition.selections.map((item) => ({ ...item, rendered: item.rendered ?? null })),
    free_text_ko: composition.free_text_ko ?? "", draft_prompt: composition.draft_prompt ?? "",
    unresolved: (composition.unresolved ?? []).map((item) => ({ ...item, id: item.id ?? null })) };
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
  if (c.schema_version !== 1) add("composition", "지원하는 구성 스키마는 v1입니다.");
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
