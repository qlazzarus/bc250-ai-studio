/**
 * EVAL-UX01: measures the description → approved draft path with the modules the
 * product actually runs. No LLM is called, no image is generated.
 *
 * What is measured, and what is not:
 *
 * - `suggestSelections` (the rule engine) is executed as-is on each fixture. Every
 *   expected ID it returns is a hit, every missing one is a miss, every ID in
 *   `forbid` is an unwanted addition, and every returned ID outside both lists is
 *   recorded as unclassified rather than silently counted as correct.
 * - Click counts and edit counts are **derived from `PROTOCOL`** and the measured
 *   sets. They are a model of the UI, not a stopwatch: this harness has no user.
 * - Elapsed time (입력 → 초안 승인) is **not measured**. There is no human in this
 *   run, so no number is invented for it; the document records it as unmeasured.
 * - The `situation_variants` arm runs the same fixtures through
 *   `variantCards`/`applyVariantScene` with a **scripted** reply, so it measures the
 *   plumbing (which candidate is applicable, how many clicks) and says nothing about
 *   model quality or `target_groups` compliance.
 *
 * Run:
 *   node --experimental-strip-types scripts/eval-ux01/evaluate.mjs
 *   node --experimental-strip-types scripts/eval-ux01/evaluate.mjs --json
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const src = (name) => join(root, "frontend", "src", "prompt", name);

const { DICTIONARY, DICTIONARY_VERSION, familyCoverage } = await import(src("dictionary.ts"));
const { suggestSelections } = await import(src("proposals.ts"));
const { compileScene, COMPILER_VERSION } = await import(src("compiler.ts"));
const { selectEntry, removeEntry } = await import(src("scene.ts"));
const { partialScope, partialDiff } = await import(src("partialChange.ts"));
const { proposalCards } = await import(src("proposalCards.ts"));
const { variantCards } = await import(src("situationVariants.ts"));
const { applyVariantScene } = await import(src("variantApply.ts"));
const { revisionsFor, VARIANT_KIND, VARIANT_GROUPS } = await import(src("llmProposals.ts"));
const { SCENES, FAMILY, PROTOCOL } = await import("./scenes.mjs");

const byId = new Map(DICTIONARY.map((entry) => [entry.id, entry]));
const labelOf = (id) => byId.get(id)?.labelKo ?? id;

/** A scene from raw ids, using the real `selectEntry` so mappings are real values. */
function sceneOf(textKo, ids = []) {
  let scene = { schemaVersion: 1, targetFamily: FAMILY, selections: [], freeTextKo: textKo };
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) throw new Error(`fixture names an unknown id: ${id}`);
    scene = selectEntry(scene, entry, DICTIONARY_VERSION);
  }
  return scene;
}

/**
 * Scripted `situation_variants` reply for the variant arm.
 *
 * Deliberately not a model output: three candidates are written here from the same
 * fixture text, each swapping only place/action. One is invalid on purpose (it tries
 * to change the clothing), so the arm can show that an out-of-scope candidate is
 * refused instead of applied. Every scene gets the same three, because the point is
 * the plumbing, not the sentence.
 */
function scriptedVariants(scene) {
  const selected = new Set(scene.selections.map((item) => item.id));
  return {
    proposal_id: "eval-ux01-variants",
    request_id: "req-evalux01",
    status: "ready",
    kind: VARIANT_KIND,
    provider: { model: "scripted", version: "eval-ux01", latency_ms: 0, finish_reason: "stop" },
    revisions: revisionsFor(scene),
    suggestions: [],
    variants: [
      {
        variant_id: "cafe-sit", label_ko: "카페에 앉기", prompt_ko: "인물이 카페에 앉아 있다.",
        changed_ids: ["pose.sitting", "setting.cafe"].filter((id) => !selected.has(id)),
        removed_ids: [], unresolved_ko: [],
      },
      {
        variant_id: "park-walk", label_ko: "공원에서 걷기", prompt_ko: "인물이 공원을 걷는다.",
        changed_ids: ["action.walking", "setting.park"].filter((id) => !selected.has(id)),
        removed_ids: ["action.standing", "location.street"].filter((id) => selected.has(id)),
        unresolved_ko: [],
      },
      // Out of scope on purpose: clothing is locked, so this must be blocked, never applied.
      {
        variant_id: "out-of-scope", label_ko: "검은 셔츠로 바꾸기",
        prompt_ko: "인물이 검은 셔츠를 입고 있다.",
        changed_ids: ["clothing.black_shirt"], removed_ids: [], unresolved_ko: [],
      },
    ],
    unresolved_spans: [],
    ambiguities: [],
    rejected: [],
    truncated: false,
    why: null, message: null, detail: null,
  };
}

/**
 * Click model for the rule path, derived only from the measured ID sets.
 *
 * An unwanted proposal costs **no click**: acceptance is per item, so the user simply
 * does not take it. It is still reported as a `distractor`, because noticing that a
 * plausible-looking chip is wrong is work — just not a click. The browser arm
 * (`browser.mjs`) confirmed this by performing the same scenes for real.
 */
function ruleClicks(result) {
  const accepted = result.hits.length;
  const missing = result.misses.length;
  // One 세부 조정 open + one category + one checkbox per missing item, as PROTOCOL says.
  const manual = missing * 3;
  return {
    input: 1,
    find: 1,
    accept: accepted,
    distractors: result.unwanted.length,
    manualFix: manual,
    total: 1 + 1 + accepted + manual,
    manualEdits: missing,
  };
}

function runScene(fixture) {
  const startScene = sceneOf(fixture.textKo, fixture.startIds ?? []);
  const hints = suggestSelections({
    freeTextKo: fixture.textKo, family: FAMILY, dictionary: DICTIONARY,
    selectedIds: startScene.selections.map((item) => item.id),
  });
  const proposed = hints.map((hint) => hint.id);
  const expected = fixture.expected.map((item) => item.id);
  const forbidden = (fixture.forbid ?? []).map((item) => item.id);

  const hits = expected.filter((id) => proposed.includes(id));
  const misses = expected.filter((id) => !proposed.includes(id));
  const unwanted = proposed.filter((id) => forbidden.includes(id));
  const unclassified = proposed.filter((id) => !expected.includes(id) && !forbidden.includes(id));

  // The selection the user would end up with after accepting hits and dropping unwanted.
  let finalScene = startScene;
  for (const id of hits) finalScene = selectEntry(finalScene, byId.get(id), DICTIONARY_VERSION);
  for (const id of unwanted) finalScene = removeEntry(finalScene, id);
  const compiled = compileScene(finalScene);

  const result = {
    id: fixture.id, title: fixture.title, kind: fixture.kind,
    hits, misses, unwanted, unclassified,
    expectedCount: expected.length,
    proposedCount: proposed.length,
    labels: { hits: hits.map(labelOf), misses: misses.map(labelOf), unwanted: unwanted.map(labelOf) },
    hints: hints.map((hint) => ({ id: hint.id, phrase: hint.matchedPhrase, score: hint.confidence })),
    unmatchedKo: fixture.unmatchedKo ?? [],
    unmatchedCount: (fixture.unmatchedKo ?? []).length,
    draft: compiled.draft,
    warnings: compiled.warnings.map((warning) => warning.code),
    finalChips: finalScene.selections.map((item) => item.labelKo),
  };
  result.clicks = ruleClicks(result);

  // Partial-change arm: the same answer, judged against the scope the button sends.
  if (fixture.request) {
    const scope = partialScope(startScene, fixture.request.targetGroups);
    const reply = {
      status: "ready", kind: "partial_change", request_id: "req-evalux01",
      revisions: revisionsFor(startScene), provider: null, why: null, message: null, detail: null,
      variants: [], truncated: false,
      suggestions: hits.map((id) => ({
        id, matched_phrase: hints.find((hint) => hint.id === id)?.matchedPhrase ?? labelOf(id),
        basis: "quote", polarity: "affirmed", actor: null, confidence: 0.9, reason_ko: "",
      })),
      unresolved_spans: [], ambiguities: [], rejected: [],
    };
    const cards = proposalCards({ reply, scene: startScene, dictionary: DICTIONARY, family: FAMILY, scope });
    const diff = partialDiff({ cards, scene: startScene, scope });
    result.partial = {
      targetGroups: scope.targetGroups,
      lockedIds: scope.lockedIds,
      lockedLabels: scope.lockedIds.map(labelOf),
      accepted: cards.batchIds.map(labelOf),
      // Cards the scope refuses: a place suggestion in a lighting-only request is
      // exactly the case this exposes.
      refused: cards.cards
        .filter((card) => card.blocks.length > 0 && card.id !== null)
        .map((card) => `${card.labelKo}:${card.blocks.join("+")}`),
      changes: diff.changes,
      kept: diff.kept,
      blocked: diff.blocked,
      noChange: diff.noChange,
    };
  }

  // Variant arm: scripted candidates, real card/applicability logic.
  const scope = partialScope(startScene, [...VARIANT_GROUPS]);
  const summary = variantCards({
    reply: scriptedVariants(startScene), scene: startScene, dictionary: DICTIONARY,
    family: FAMILY, scope,
  });
  const applicable = summary.cards.filter((card) => card.blocks.length === 0);
  const applied = applicable.length > 0
    ? applyVariantScene({
      scene: startScene, card: applicable[0], dictionary: DICTIONARY,
      dictionaryVersion: DICTIONARY_VERSION,
    })
    : null;
  result.variant = {
    cards: summary.cards.length,
    blocked: summary.cards.length - applicable.length,
    applicableLabels: applicable.map((card) => card.labelKo),
    blockedReasons: summary.cards
      .filter((card) => card.blocks.length > 0)
      .map((card) => `${card.labelKo}:${card.blocks.join("+")}`),
    // Undo is `recordVariantApply`'s stored `before`, so "restores exactly" is the
    // start scene surviving the apply untouched.
    undoRestores: applied !== null
      && JSON.stringify(applied.scene) !== JSON.stringify(startScene)
      && JSON.stringify(startScene) === JSON.stringify(sceneOf(fixture.textKo, fixture.startIds ?? [])),
    clicks: 1 + 1 + (applicable.length > 0 ? 1 : 0),
  };
  return result;
}

export function runEvaluation() {
  const rows = SCENES.map(runScene);

  const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
  const pooled = {
    scenes: rows.length,
    expected: sum(rows, (row) => row.expectedCount),
    hits: sum(rows, (row) => row.hits.length),
    misses: sum(rows, (row) => row.misses.length),
    unwanted: sum(rows, (row) => row.unwanted.length),
    unclassified: sum(rows, (row) => row.unclassified.length),
    proposed: sum(rows, (row) => row.proposedCount),
    // Text the dictionary cannot express. Not a rule failure: the original is kept
    // verbatim in `free_text_ko` and the draft says nothing about it.
    unmatchedKo: sum(rows, (row) => row.unmatchedCount),
  };
  pooled.recall = pooled.expected ? pooled.hits / pooled.expected : null;
  // Precision denominator is what the rules actually proposed, so an unwanted hit lowers it.
  pooled.precision = pooled.proposed ? (pooled.proposed - pooled.unwanted) / pooled.proposed : null;
  // An `unclassified` proposal is neither expected nor forbidden: it needs a human
  // decision, so precision over the *decided* proposals is reported separately instead
  // of quietly counting those as correct.
  const decided = pooled.proposed - pooled.unclassified;
  pooled.precisionDecided = decided ? (decided - pooled.unwanted) / decided : null;
  pooled.clicksTotal = sum(rows, (row) => row.clicks.total);
  pooled.clicksPerScene = pooled.clicksTotal / rows.length;
  pooled.manualFixTotal = sum(rows, (row) => row.clicks.manualFix);
  pooled.manualEditsTotal = sum(rows, (row) => row.clicks.manualEdits);
  pooled.distractors = sum(rows, (row) => row.clicks.distractors);
  // Clicks actually spent on usable items: everything except the manual repair clicks.
  pooled.ruleClicksOnly = pooled.clicksTotal - pooled.manualFixTotal;
  pooled.variantClicksTotal = sum(rows, (row) => row.variant.clicks);
  pooled.variantBlocked = sum(rows, (row) => row.variant.blocked);
  pooled.variantUndoRestores = rows.filter((row) => row.variant.undoRestores).length;
  pooled.partialRefused = sum(rows, (row) => (row.partial ? row.partial.refused.length : 0));

  const config = {
    evaluatedAt: "2026-11-18",
    fixtureSource: "scripts/eval-ux01/scenes.mjs (project-authored, 12 scenes)",
    dictionary: {
      version: DICTIONARY_VERSION, entries: DICTIONARY.length, family: FAMILY,
      coverage: familyCoverage(DICTIONARY, FAMILY),
    },
    compiler: COMPILER_VERSION,
    llm: {
      called: 0, model: null,
      note: "규칙 엔진만 실행했다. 실제 LLM 응답·모델 설정·지연은 측정하지 않았다.",
    },
    variantArm: { scripted: true, note: "후보 문장은 스크립트이며 모델 품질 평가가 아니다." },
    unmeasured: [
      "입력→초안 승인 소요 시간", "실제 LLM 응답의 정확도·지연",
      "사용자 주관 평가", "실제 생성 이미지 품질",
    ],
    protocol: PROTOCOL,
  };
  return { config, pooled, scenes: rows };
}

const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

/**
 * Only runs when this file is the entry point. The unit test imports
 * `runEvaluation()` instead, so it must not print or exit on import.
 */
function main() {
  const { config, pooled, scenes: rows } = runEvaluation();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ config, pooled, scenes: rows }, null, 2));
    return;
  }
  console.log(`EVAL-UX01 · ${config.fixtureSource}`);
  console.log(`사전 ${config.dictionary.version} · ${config.dictionary.entries}개 · 계열 ${FAMILY} ` +
    `(${config.dictionary.coverage.mapped}/${config.dictionary.coverage.total} 매핑) · ` +
    `compiler ${config.compiler} · LLM 호출 0회`);
  console.log("");
  console.log("id                          기대 적중 누락 오탐 미분류  클릭(보정)");
  for (const row of rows) {
    console.log([
      row.id.padEnd(26),
      String(row.expectedCount).padStart(4),
      String(row.hits.length).padStart(4),
      String(row.misses.length).padStart(4),
      String(row.unwanted.length).padStart(4),
      String(row.unclassified.length).padStart(6),
      `${String(row.clicks.total).padStart(4)}(${row.clicks.manualEdits})`,
    ].join(" "));
    if (row.misses.length) console.log(`  누락: ${row.labels.misses.join(", ")}`);
    if (row.unwanted.length) console.log(`  오탐(원치 않은 추가): ${row.labels.unwanted.join(", ")}`);
    if (row.unclassified.length) console.log(`  미분류: ${row.unclassified.join(", ")}`);
  }
  console.log("");
  console.log(`합계 · 기대 ${pooled.expected} · 적중 ${pooled.hits} (recall ${pct(pooled.recall)}) · ` +
    `누락 ${pooled.misses} · 원치 않은 추가 ${pooled.unwanted} · 미분류 ${pooled.unclassified}`);
  console.log(`규칙 경로 precision ${pct(pooled.precision)} (제안 ${pooled.proposed}개 기준)`);
  console.log(`결정 가능한 제안만 계산한 precision ${pct(pooled.precisionDecided)} ` +
    `(사람이 판정해야 할 미분류 ${pooled.unclassified}개 제외)`);
  console.log(`사전 밖 표현 ${pooled.unmatchedKo}개 · 원문은 그대로 보존되고 초안에는 들어가지 않는다`);
  console.log(`규칙 경로 클릭 합계 ${pooled.clicksTotal} (장면당 ${pooled.clicksPerScene.toFixed(1)}) · ` +
    `그중 수동 보정 ${pooled.manualFixTotal}회(누락 ${pooled.manualEditsTotal}개 ×3) · ` +
    `규칙 제안만 쓸 때 ${pooled.ruleClicksOnly}회`);
  console.log(`원치 않은 제안 ${pooled.distractors}개는 클릭을 쓰지 않지만, 알아채고 넘겨야 하는 항목이다`);
  console.log("초안은 자동 미리보기(UX03)라 클릭 0 · 초안 승인(적용) 1회는 위 클릭에 포함되지 않았다");
  console.log(`상황 후보 경로 클릭 합계 ${pooled.variantClicksTotal} · 되돌리기까지 확인 ` +
    `${pooled.variantUndoRestores}/${rows.length} · 차단된 후보 ${pooled.variantBlocked}건`);
  const partial = rows.find((row) => row.partial);
  if (partial) {
    console.log(`부분 변경(${partial.id}) · 대상 ${partial.partial.targetGroups.join(",")} · ` +
      `고정 ${partial.partial.lockedLabels.join(",")} · 추가 ${partial.partial.accepted.join(",")} · ` +
      `차단 ${partial.partial.blocked}${partial.partial.refused.length ? ` (${partial.partial.refused.join(", ")})` : ""}`);
  }
  console.log("");
  console.log(`미측정: ${config.unmeasured.join(" · ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();