import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DICTIONARY } from "../src/prompt/dictionary.ts";
import { runEvaluation } from "../../scripts/eval-ux01/evaluate.mjs";
import { SCENES } from "../../scripts/eval-ux01/scenes.mjs";

/**
 * EVAL-UX01 evidence tests.
 *
 * These do **not** claim the rule engine is good. They pin the two things that make
 * the published numbers checkable:
 *
 * 1. the denominators (12 scenes, every expectation resolvable to a real dictionary
 *    id, no duplicated or contradictory fixture),
 * 2. the aggregate values the document quotes, so a later dictionary or matcher
 *    change shows up as a failing test instead of a silently different report.
 *
 * A change in recall/precision is a legitimate reason to update the doc **and** this
 * test together; it is not a reason to loosen the assertion.
 */

const report = runEvaluation();
const byId = new Map(DICTIONARY.map((entry) => [entry.id, entry]));
const ids = new Set(DICTIONARY.map((entry) => entry.id));
const scriptSource = readFileSync(
  fileURLToPath(new URL("../../scripts/eval-ux01/evaluate.mjs", import.meta.url)), "utf8");

test("the fixture set is the twelve hand-written scenes the document describes", () => {
  assert.equal(SCENES.length, 12);
  assert.equal(report.scenes.length, 12);
  assert.equal(new Set(SCENES.map((scene) => scene.id)).size, 12);
  // The task description names these categories; the set must actually cover them.
  const kinds = new Set(SCENES.map((scene) => scene.kind));
  for (const kind of ["common", "product", "landscape", "multi_person", "negation", "partial"]) {
    assert.ok(kinds.has(kind), `missing scene kind: ${kind}`);
  }
  assert.ok(SCENES.filter((scene) => scene.kind === "multi_person").length >= 2);
  // Negation is marked on the fixture, not inferred from `kind`: one of the two is a
  // landscape, because "사람은 없다" appears in landscape prose too.
  assert.ok(SCENES.filter((scene) => scene.negated === true).length >= 2);
  assert.ok(SCENES.filter((scene) => Boolean(scene.request)).length === 1, "one partial-edit scene");
});

test("every expectation, forbid entry and start selection is a real dictionary id", () => {
  for (const scene of SCENES) {
    for (const item of scene.expected) assert.ok(ids.has(item.id), `${scene.id}: ${item.id}`);
    for (const item of scene.forbid ?? []) assert.ok(ids.has(item.id), `${scene.id}: ${item.id}`);
    for (const id of scene.startIds ?? []) assert.ok(ids.has(id), `${scene.id}: ${id}`);
    // The browser arm seeds the same cast by label, so the two lists must agree in length.
    if (scene.startLabels) assert.equal(scene.startLabels.length, (scene.startIds ?? []).length);
    for (const label of scene.startLabels ?? []) {
      assert.ok(DICTIONARY.some((entry) => entry.labelKo === label), `${scene.id}: ${label}`);
    }
    // A fixture that both expects and forbids the same id has no correct answer.
    const expected = new Set(scene.expected.map((item) => item.id));
    for (const item of scene.forbid ?? []) assert.ok(!expected.has(item.id), `${scene.id} contradicts itself: ${item.id}`);
    // Every "the dictionary cannot express this" note must be a non-empty span.
    for (const item of scene.unmatchedKo ?? []) assert.ok(item.text.trim() && item.why.trim());
    // Every expectation states why it belongs in the scene, so a reviewer can audit it.
    for (const item of scene.expected) assert.ok(item.why.trim(), `${scene.id}: ${item.id} has no rationale`);
  }
});

test("the expectations were not derived from the engine under test", () => {
  // A copied answer would make recall 100% by construction. The evaluation runner may
  // only read `expected`; the fixture file may not import the matcher or the
  // dictionary, and may not contain an `import`/`require` of any product module.
  const fixtureSource = readFileSync(
    fileURLToPath(new URL("../../scripts/eval-ux01/scenes.mjs", import.meta.url)), "utf8");
  assert.ok(!/\bimport\b\s*\(?\s*["'`]/.test(fixtureSource), "fixtures must not import product code");
  assert.ok(!/\brequire\(/.test(fixtureSource));
  // The doc comment may explain *why* it does not import the matcher; only a call or an
  // assignment would mean the answer was copied from it.
  assert.ok(!/suggestSelections\s*\(/.test(fixtureSource));
  // ...and the published recall is therefore below 100 %: the misses are findings.
  assert.ok(report.pooled.recall < 1, "recall of 100% means the expectations were copied");
  assert.ok(report.pooled.misses > 0);
  assert.ok(scriptSource.includes("runEvaluation"));
});

test("pooled denominators match the per-scene rows", () => {
  const sum = (pick) => report.scenes.reduce((total, row) => total + pick(row), 0);
  assert.equal(report.pooled.expected, sum((row) => row.expectedCount));
  assert.equal(report.pooled.hits, sum((row) => row.hits.length));
  assert.equal(report.pooled.misses, sum((row) => row.misses.length));
  assert.equal(report.pooled.unwanted, sum((row) => row.unwanted.length));
  assert.equal(report.pooled.unclassified, sum((row) => row.unclassified.length));
  assert.equal(report.pooled.clicksTotal, sum((row) => row.clicks.total));
  assert.equal(report.pooled.variantClicksTotal, sum((row) => row.variant.clicks));
  // Every expectation is accounted for exactly once: either proposed (hit) or not (miss).
  assert.equal(report.pooled.hits + report.pooled.misses, report.pooled.expected);
  // Every proposal is classified exactly once, so the precision denominators are fixed.
  assert.equal(report.pooled.hits + report.pooled.unwanted + report.pooled.unclassified,
    report.pooled.proposed);
});

test("negation scenes keep the person out even though the text contains 사람", () => {
  // Selected by the fixture's own `negated` marker, not by its category label: a
  // landscape can be a negation case too.
  const negated = new Set(SCENES.filter((scene) => scene.negated === true).map((scene) => scene.id));
  const negations = report.scenes.filter((row) => negated.has(row.id));
  assert.equal(negations.length, 2);
  for (const row of negations) {
    assert.ok(row.unwanted.includes("subject.person"), `${row.id} should flag the substring false positive`);
    // The prompt the user would end up with must not describe a person.
    assert.ok(!row.finalChips.includes("인물"), `${row.id} kept 인물`);
    assert.ok(!/a person/.test(row.draft), `${row.id} draft mentions a person: ${row.draft}`);
  }
});

test("the partial-change scene locks the cast and refuses a place suggestion", () => {
  const partial = report.scenes.find((row) => row.partial);
  assert.ok(partial, "no partial-change fixture");
  assert.deepEqual(partial.partial.targetGroups, ["lighting"]);
  assert.deepEqual(partial.partial.lockedIds, ["subject.person", "clothing.white_shirt"]);
  // The text mentions 카페, but a lighting-only request must not add a place.
  assert.ok(partial.partial.refused.some((line) => line.startsWith("카페:")), JSON.stringify(partial.partial.refused));
  for (const refused of partial.partial.refused) assert.match(refused, /out_of_scope|locked/);
  // Nothing outside the target group may enter the accepted set.
  const acceptedEntry = (label) => DICTIONARY.find((entry) => entry.labelKo === label);
  for (const label of partial.partial.accepted) {
    assert.equal(acceptedEntry(label)?.category, "lighting", `${label} is not a lighting item`);
  }
});

test("the variant arm is scripted, applies nothing automatically and always undoes", () => {
  for (const row of report.scenes) {
    // Three scripted candidates per scene; the clothing one must never be applicable.
    assert.equal(row.variant.cards, 3, row.id);
    assert.equal(row.variant.blocked, 1, `${row.id}: ${row.variant.blockedReasons.join(",")}`);
    assert.ok(row.variant.blockedReasons[0].startsWith("검은 셔츠로 바꾸기:"));
    assert.ok(!row.variant.applicableLabels.includes("검은 셔츠로 바꾸기"));
    // Apply is a real scene edit, and the recorded pre-apply scene survives intact.
    assert.equal(row.variant.undoRestores, true, `${row.id} lost its pre-apply scene`);
    // Two clicks to request + one to apply; nothing else is needed.
    assert.equal(row.variant.clicks, 3);
  }
  assert.equal(report.pooled.variantUndoRestores, 12);
  assert.equal(report.config.variantArm.scripted, true);
});

test("the configuration records what was not measured", () => {
  assert.equal(report.config.llm.called, 0);
  assert.equal(report.config.llm.model, null);
  assert.ok(report.config.unmeasured.some((item) => item.includes("시간")));
  assert.ok(report.config.unmeasured.some((item) => item.includes("LLM")));
  assert.ok(report.config.unmeasured.some((item) => item.includes("이미지")));
  // No generated image, no job, no network in this evaluation.
  const source = scriptSource;
  assert.ok(!/fetch\(|axios|XMLHttpRequest/.test(source), "the evaluation must not call the network");
  assert.ok(!/generate|image/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")),
    "the evaluation must not reach a generation path");
  assert.equal(byId.size, DICTIONARY.length);
});

test("the quoted aggregates still hold", () => {
  assert.equal(report.pooled.scenes, 12);
  assert.equal(report.pooled.expected, 38);
  assert.equal(report.pooled.hits, 29);
  assert.equal(report.pooled.misses, 9);
  assert.equal(report.pooled.unwanted, 3);
  assert.equal(report.pooled.unclassified, 2);
  assert.equal(report.pooled.proposed, 34);
  assert.equal(report.pooled.unmatchedKo, 23);
  // 80 = 2 (입력·찾기) × 12 + 29 수락 + 27 수동 보정. An unwanted proposal costs no
  // click, so it is counted in `distractors`, not in the click total.
  assert.equal(report.pooled.clicksTotal, 80);
  assert.equal(report.pooled.ruleClicksOnly, 53);
  assert.equal(report.pooled.manualFixTotal, 27);
  assert.equal(report.pooled.manualEditsTotal, 9);
  assert.equal(report.pooled.distractors, 3);
  assert.equal(report.pooled.variantClicksTotal, 36);
  assert.equal(report.pooled.variantBlocked, 12);
  assert.equal(report.pooled.partialRefused, 1);
});

test("the committed evidence matches a fresh run", () => {
  // The doc quotes these files. If they drift from the code, the doc is wrong even
  // though the test above passes, so compare the committed summary line by line.
  const committed = readFileSync(fileURLToPath(
    new URL("../../docs/evidence/prompt-composer-eval-ux01/results.json", import.meta.url)), "utf8");
  const saved = JSON.parse(committed);
  assert.deepEqual(saved.pooled, report.pooled);
  assert.equal(saved.scenes.length, report.scenes.length);
  for (const [index, row] of report.scenes.entries()) {
    assert.equal(saved.scenes[index].id, row.id);
    assert.equal(saved.scenes[index].draft, row.draft);
    assert.deepEqual(saved.scenes[index].hits, row.hits);
    assert.deepEqual(saved.scenes[index].finalChips, row.finalChips);
  }
  assert.equal(saved.config.dictionary.version, report.config.dictionary.version);
  assert.equal(saved.config.compiler, report.config.compiler);
  assert.equal(saved.config.llm.called, 0);
});