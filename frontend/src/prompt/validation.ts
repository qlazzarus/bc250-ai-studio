import type { PromptComposition, StoredSnapshotV3 } from "../api";
// The `.ts` extension is required: `frontend/tests` load `src` through Node's native type
// stripping, which does not guess extensions, and `validation.ts` is imported there.
import { TRIM_STEPS } from "./composeSnapshot.ts";

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

/** Scene limits mirrored from `SceneV3`; `known` is the set of defined entity IDs. */
function validateSceneV3(
  value: unknown,
  selections: unknown[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scene = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>) : {};
  const items = (item: unknown): unknown[] => (Array.isArray(item) ? item : []);
  const objects = (item: unknown) =>
    items(item).filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry));

  const entities = objects(scene.entities);
  if (entities.length > 8) issues.push({ field: "scene", message: `${entities.length}/8개: 장면 개체를 줄여 주세요.` });
  const known = new Set(entities
    .map((entity) => (typeof entity.entity_id === "string" ? entity.entity_id : ""))
    .filter((id) => id.length > 0));
  const owns = (id: unknown) => typeof id === "string" && known.has(id);

  // Every reference into the scene has to resolve: a selection, a relation endpoint, an
  // unmapped detail, or an ambiguity option pointing at a missing entity is a 422 later.
  for (const entry of selections) {
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const selection = entry as Record<string, unknown>;
      if (selection.entity_id !== undefined && !owns(selection.entity_id)) {
        issues.push({ field: "selections", message: `${String(selection.id ?? "")}: 장면에 없는 개체를 가리킵니다.` });
      }
    }
  }
  const relations = objects(scene.relations);
  if (relations.length > 12) issues.push({ field: "scene", message: `${relations.length}/12개: 관계를 줄여 주세요.` });
  for (const relation of relations) {
    for (const endpoint of [relation.subject_entity_id, relation.object_entity_id]) {
      if (typeof endpoint === "string" && !known.has(endpoint)) {
        issues.push({ field: "scene", message: `관계가 장면에 없는 개체를 가리킵니다: ${endpoint}` });
      }
    }
  }
  for (const item of objects(scene.unmapped_details)) {
    if (typeof item.entity_id === "string" && !known.has(item.entity_id)) {
      issues.push({ field: "scene", message: `미변환 항목이 장면에 없는 개체를 가리킵니다: ${item.entity_id}` });
    }
  }
  for (const ambiguity of objects(scene.ambiguities)) {
    for (const option of items(ambiguity.options)) {
      if (typeof option === "string" && !known.has(option)) {
        issues.push({ field: "scene", message: `선택지가 장면에 없는 개체를 가리킵니다: ${option}` });
      }
    }
  }
  return issues;
}

/** `applied` is present-and-complete or absent: a `null` would be a third, meaningless state. */
function validateAppliedV3(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value === undefined) return issues;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push({ field: "composition", message: "적용 기록의 형식이 올바르지 않습니다." });
    return issues;
  }
  const applied = value as Record<string, unknown>;
  const text = (field: string, limit: number, required: boolean) => {
    const entry = applied[field];
    if (typeof entry !== "string") {
      if (required) issues.push({ field: "applied", message: "적용 기록이 불완전합니다. 초안을 다시 적용하세요." });
      return;
    }
    issues.push(...validateText(entry, "applied", limit, required));
  };
  for (const field of ["result_id", "candidate_id", "provider_model"]) text(field, 200, true);
  text("applied_at", 20, true);
  text("positive_prompt", 8000, true);
  text("negative_prompt", 4000, false);
  text("summary_ko", 600, false);
  if (typeof applied.applied_at === "string"
      && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(applied.applied_at)) {
    issues.push({ field: "applied", message: "적용 시각 형식이 올바르지 않습니다." });
  }
  return issues;
}

/**
 * UCP07: validate a v3 snapshot. It is a *different record* from v1/v2, not a wider one.
 *
 * This exists because `validateComposition` describes the dictionary-builder shape:
 * `free_text_ko`, `draft_prompt`, `unresolved`, `selections[].label_ko`. A v3 body has none
 * of those, so routing one through it threw a `TypeError` and generation was impossible
 * from the UI once a v3 draft was applied.
 *
 * The checks mirror the server's, in the server's order of importance:
 *
 * - the family must match, or the job is refused with 422 before it is queued;
 * - a snapshot needs Korean text or a chosen selection (UCP01 fix A): a veto alone records
 *   nothing to generate;
 * - a chosen selection needs `pinned`, an excluded one must not carry it, and no selection
 *   may attribute to an entity the scene does not define;
 * - `applied` is present-and-complete or absent, never `null`;
 * - `snapshot_trim` may only name steps from the fixed ladder.
 *
 * The 32 KiB cap is deliberately *not* enforced here. The server trims an oversize v3
 * record with that ladder and reports it in `snapshot_trim`; refusing in the browser would
 * block a body the server is able to store, and the user would have no way to submit it.
 */
export function validateSnapshotV3(c: StoredSnapshotV3, family: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const items = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const text = (value: unknown, field: string, limit: number, required = false) => {
    if (typeof value !== "string") {
      if (required) add(field, "빈 값은 사용할 수 없습니다.");
      return;
    }
    issues.push(...validateText(value, field, limit, required));
  };

  text(c.compiler_version, "composition", 100, true);
  text(c.dictionary_version, "composition", 100, true);
  text(c.target_model_id, "composition", 100, true);
  text(c.target_family, "composition", 100, true);
  if (typeof c.target_family === "string" && c.target_family !== family) {
    add("composition", "모델 계열이 다릅니다. 대상 모델에서 초안을 다시 만들고 적용하세요.");
  }
  if (typeof c.profile_version !== "number" || c.profile_version < 1) {
    add("composition", "출력 프로필 버전이 없습니다. 초안을 다시 적용하세요.");
  }
  // v3 records `brief_ko` where v1/v2 recorded `free_text_ko` + `draft_prompt`.
  text(c.brief_ko, "brief_ko", 4000);

  const selections = items(c.selections);
  if (selections.length > 100) add("selections", `${selections.length}/100개: 선택을 줄여 주세요.`);
  const ids = new Set<string>();
  for (const entry of selections) {
    if (!isObject(entry)) { add("selections", "선택 항목의 형식이 올바르지 않습니다."); continue; }
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!id) add("selections", "선택 항목에 ID가 없습니다.");
    else if (ids.has(id)) add("selections", `중복 ID ${id}: 항목을 다시 선택하세요.`);
    ids.add(id);
    text(entry.id, "selections", 100, true);
    const source = entry.source;
    if (source === "excluded") {
      // An excluded chip keeps nothing, so a pin or an owner on it is a contradiction.
      if (entry.pinned !== undefined) add("selections", `${id}: 제외한 항목에는 고정 표시를 넣을 수 없습니다.`);
      if (entry.entity_id !== undefined) add("selections", `${id}: 제외한 항목에는 개체 귀속을 넣을 수 없습니다.`);
    } else if (source === "auto" || source === "manual") {
      if (typeof entry.pinned !== "boolean") add("selections", `${id}: 고정 여부가 없습니다. 다시 선택하세요.`);
      if (entry.entity_id !== undefined) text(entry.entity_id, "selections", 100, true);
    } else {
      add("selections", `${id}: 선택 종류가 올바르지 않습니다.`);
    }
  }
  // Fix A: chips without a brief are a valid composition; a veto without either is not.
  const chosen = selections.some((entry) => isObject(entry) && entry.source !== "excluded");
  if (!String(c.brief_ko ?? "").trim() && !chosen) {
    add("composition", "한글 설명이나 선택한 항목이 하나는 있어야 합니다.");
  }

  issues.push(...validateSceneV3(c.scene, selections));
  issues.push(...validateAppliedV3(c.applied));
  for (const step of items(c.snapshot_trim)) {
    if (!(TRIM_STEPS as readonly unknown[]).includes(step)) {
      add("composition", `알 수 없는 축소 단계입니다: ${String(step)}`);
    }
  }
  return issues;
}

/** Routes a stored record to the validator that describes its version. */
export function validateCompositionBody(c: StoredSnapshotV3, family: string): ValidationIssue[] {
  if (c.schema_version === 3) return validateSnapshotV3(c, family);
  return validateComposition(c as unknown as PromptComposition, family);
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
  if (body.prompt_composition) issues.push(...validateCompositionBody(body.prompt_composition as StoredSnapshotV3, family));
  const bytes = utf8Bytes(JSON.stringify(body));
  if (maxBodyBytes !== null && bytes > maxBodyBytes) issues.push({ field: "request", message: `${bytes}/${maxBodyBytes}바이트: 전체 요청이 너무 큽니다. 프롬프트나 구성을 줄여 주세요.` });
  return issues;
}
