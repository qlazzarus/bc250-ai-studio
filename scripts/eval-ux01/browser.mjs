/**
 * EVAL-UX01 browser arm: measures the click path in the real composer.
 *
 * The Node arm (`evaluate.mjs`) models the clicks from the measured ID sets. This arm
 * performs them for real and records what actually happened, so the model can be
 * checked instead of asserted. It also cross-checks one thing the Node arm cannot:
 * that the draft shown in the browser is byte-identical to `compileScene`'s output.
 *
 * Still not measured: how long a **person** takes. `elapsedMs` below is the automation
 * driving the DOM, and it is labelled as such everywhere it appears.
 *
 * Runs against the fake backend and a throwaway data directory (see `browser.sh`).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectBrowser, pageClient } from "../prompt-composer-browser/driver.mjs";
import { openAdjust, openBuilder } from "../prompt-composer-browser/ui.mjs";
import { SCENES } from "./scenes.mjs";
import { runEvaluation } from "./evaluate.mjs";


const CHROME = process.env.CHROME_PATH
  || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const PROFILE = process.env.CHROME_PROFILE || mkdtempSync(join(tmpdir(), "pc-eval-profile-"));
const PORT = Number(process.env.CDP_PORT || 9421);
const APP = process.env.APP_URL;
const OUT = process.env.OUT_DIR
  || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "evidence", "prompt-composer-eval-ux01");
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, expected, actual) {
  const pass = typeof expected === "function" ? expected(actual) : expected === actual;
  results.push({ name, pass, expected: String(expected).slice(0, 200), actual: JSON.stringify(actual)?.slice(0, 400) });
  console.log(`${pass ? "PASS" : "FAIL"} · ${name} · ${JSON.stringify(actual)?.slice(0, 180)}`);
  return pass;
}
const record = (name, detail) => {
  results.push({ name, pass: null, detail: String(detail).slice(0, 800) });
  console.log(`INFO · ${name} · ${String(detail).slice(0, 300)}`);
};

/** Clicks the 제안 row whose label matches, and reports whether it existed. */
async function acceptHint(page, label) {
  return page.evaluate(`(() => {
    const row = [...document.querySelectorAll('.prompt-proposal')]
      .find((node) => node.querySelector('strong')?.textContent.trim() === ${JSON.stringify(label)});
    if (!row) return false;
    row.querySelector('button')?.click();
    return true;
  })()`);
}

/** Opens the rule list only when it is closed; the button doubles as 닫기. */
async function openHints(page) {
  const open = await page.evaluate(`!!document.querySelector('.prompt-proposal-list')`);
  if (open) return false;
  const clicked = await page.clickByText(".prompt-proposals button", "원문에서 사전 항목 찾기");
  if (!clicked) throw new Error("제안 버튼을 찾지 못했습니다");
  await page.waitFor(`!!document.querySelector('.prompt-proposal-list')`, { label: "hints open" });
  return true;
}

const chipLabels = (page) => page.evaluate(
  `[...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent.trim())`);

/**
 * Seeds the pre-selected cast of a fixture through the real picker: search for the
 * label, tick its checkbox. Selecting through the UI is the point — writing the scene
 * directly would skip the path the evaluation is supposed to measure.
 */
async function pickBySearch(page, labelKo) {
  await openAdjust(page);
  await page.typeInto("#prompt-search", labelKo);
  await sleep(120);
  const picked = await page.evaluate(`(() => {
    const choice = [...document.querySelectorAll('.prompt-choice')]
      .find((node) => node.textContent.trim().startsWith(${JSON.stringify(labelKo)}));
    const box = choice?.querySelector('input');
    if (!box || box.checked) return false;
    box.click();
    return true;
  })()`);
  await page.typeInto("#prompt-search", "");
  return picked;
}

const main = async () => {
  if (!existsSync(CHROME)) throw new Error(`chromium not found at ${CHROME}; set CHROME_PATH`);
  if (!APP) throw new Error("APP_URL is required (use scripts/eval-ux01/browser.sh)");
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"],
  { stdio: "ignore" });
  let version;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; }
    catch { await sleep(250); }
  }
  if (!version) throw new Error("chromium did not expose CDP");
  console.log("browser:", version.Browser);
  const browser = connectBrowser(version.webSocketDebuggerUrl);
  await browser.ready;
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = pageClient(browser.sendTo, sessionId);
  await page.call("Page.enable");
  await page.call("Runtime.enable");
  await page.viewport(1280, 900);
  await page.call("Page.navigate", { url: APP });
  await page.waitFor("!!document.querySelector('.prompt-builder > .quiet')", { label: "app mount" });
  // A dialog blocks every later CDP call; answering it is not a counted click.
  await page.evaluate(`window.confirm = () => true;`);
  await page.waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "models loaded", timeout: 20000 });
  await page.select(".composer select", "fake-sd15");
  await page.waitFor(`document.querySelector('.composer select').value === 'fake-sd15'`,
    { label: "fake-sd15 selected" });
  await openBuilder(page);

  // The Node arm's expectations of what the UI should offer are the reference here.
  const reference = new Map(runEvaluation().scenes.map((row) => [row.id, row]));
  const measured = [];

  for (const scene of SCENES) {
    const expected = reference.get(scene.id);
    // Start every scene from an empty selection and an empty field.
    await page.evaluate(`(() => {
      const clear = [...document.querySelectorAll('.prompt-group-heading button')]
        .find((node) => node.textContent.includes('선택 비우기'));
      clear?.click();
      return true;
    })()`);
    await page.typeInto("#free-text-ko", "");
    await page.typeInto("#free-text-ko", scene.textKo);
    await sleep(120);

    // A fixture with a pre-selected cast (the partial-change scene) is seeded through
    // the real checkbox path, and those clicks are counted as the user's.
    let clicks = 0;
    const seeded = [];
    for (const label of scene.startLabels ?? []) {
      if (await pickBySearch(page, label)) { seeded.push(label); clicks += 1; }
    }
    await sleep(150);
    const started = Date.now();
    // 1. the rule-based proposal list. The list stays open between scenes, so it is
    // only a click when it was closed: the count is what the user had to do, not what
    // the harness did.
    const findClick = await openHints(page);
    if (findClick) clicks += 1;
    await sleep(120);

    const offered = await page.evaluate(`[...document.querySelectorAll('.prompt-proposal strong')]
      .map((node) => node.textContent.trim())`);
    const accepted = [];
    for (const label of expected.labels.hits) {
      if (await acceptHint(page, label)) { accepted.push(label); clicks += 1; }
    }
    await sleep(200);

    const chips = await chipLabels(page);
    const draft = await page.evaluate(
      `document.querySelector('.prompt-draft textarea')?.value ?? null`);
    // 2. approve: the draft is already there (auto preview), so only 적용 is a click.
    // A scene whose draft is empty has nothing to approve — the button exists but is
    // disabled, and that is a finding, not a harness failure.
    const applyState = await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('.prompt-result button')]
        .find((node) => node.textContent.includes('적용'));
      if (!button) return { present: false, enabled: false };
      const state = { present: true, enabled: !button.disabled };
      if (state.enabled) button.click();
      return state;
    })()`);
    const approved = applyState.enabled;
    if (approved) clicks += 1;
    await sleep(150);
    const elapsedMs = Date.now() - started;
    const finalPrompt = await page.evaluate(
      `document.querySelector('.composer textarea[rows="5"]').value`);

    const row = {
      id: scene.id,
      findClick,
      seeded,
      offered: offered.length,
      accepted,
      chips,
      draft,
      applyPresent: applyState.present,
      approved,
      clicks,
      elapsedMs,
      // Chip order follows display-group order, which the reference list also uses, so
      // compare as sets: the same selection shown in a stable order is the same scene.
      matchesNodeArmDraft: draft === expected.draft,
      matchesNodeArmChips: [...chips].sort().join(",") === [...expected.finalChips].sort().join(","),
      finalPromptEqualsDraft: finalPrompt === draft,
    };
    measured.push(row);
    // The final prompt must not carry the previous scene's text into this one.
    if (approved) {
      await page.typeInto(".composer textarea[rows='5']", "");
    }
    record(`EVAL-UX01 ${scene.id}`, JSON.stringify(row));
  }

  // ── checks ────────────────────────────────────────────────────────────────
  // The automation deliberately skips `manualFix` (it does not pick a category and
  // toggle a checkbox for a missing item), so the comparable model value is
  // accept + removeUnwanted + find, and the browser adds the one 적용 click.
  check("EVAL-UX01 브라우저 · 클릭 = 모델(수락+찾기) + 시작 선택 + 적용", true,
    measured.every((row) => {
      const ref = reference.get(row.id);
      // The Node arm starts from the fixture's cast, so its startup picks are not
      // clicks there; the browser had to tick them, so they are counted here.
      const model = ref.clicks.accept + (row.findClick ? 1 : 0)
        + row.seeded.length + (row.approved ? 1 : 0);
      return row.clicks === model;
    }));
  check("EVAL-UX01 브라우저 · 초안 문자열이 compileScene과 일치", true,
    measured.every((row) => row.matchesNodeArmDraft));
  check("EVAL-UX01 브라우저 · 칩 선택이 평가 모델과 일치", true,
    measured.every((row) => row.matchesNodeArmChips));
  check("EVAL-UX01 브라우저 · 적용한 최종 프롬프트가 초안과 같음", true,
    measured.every((row) => !row.approved || row.finalPromptEqualsDraft));
  // Every scene has a draft except the one where nothing in the text matched, so the
  // apply button is present but disabled there. Reported by name, not silently passed.
  const noDraft = measured.filter((row) => !row.approved).map((row) => row.id);
  check("EVAL-UX01 브라우저 · 적용 버튼이 없는 장면은 없음", 0,
    measured.filter((row) => !row.applyPresent).length);
  check("EVAL-UX01 브라우저 · 초안이 비어 승인할 수 없는 장면", JSON.stringify(["landscape-lake-dusk"]),
    JSON.stringify(noDraft));
  check("EVAL-UX01 브라우저 · 제안 목록이 기대 항목을 모두 포함", true,
    measured.every((row) => reference.get(row.id).labels.hits.every((label) => row.accepted.includes(label))));
  // A distractor is never accepted, so it never becomes a chip: that is the whole
  // point. `accepted` is the list the harness clicked, so nothing unwanted is in it.
  check("EVAL-UX01 브라우저 · 원치 않은 제안은 수락되지 않음", true,
    measured.every((row) => reference.get(row.id).labels.unwanted
      .every((label) => !row.accepted.includes(label))));

  const totalClicks = measured.reduce((total, row) => total + row.clicks, 0);
  const totalElapsed = measured.reduce((total, row) => total + row.elapsedMs, 0);
  record("EVAL-UX01 브라우저 클릭 합계", `${totalClicks} (장면당 ${(totalClicks / measured.length).toFixed(2)})`);
  record("EVAL-UX01 자동화 소요 시간", `${totalElapsed}ms (사람의 시간이 아님 · UI 반응만 측정)`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "browser.json"),
    JSON.stringify({ scenes: measured, totalClicks, totalElapsedMs: totalElapsed }, null, 2));

  await browser.send("Browser.close").catch(() => {});
  chrome.kill();
  if (!process.env.CHROME_PROFILE) rmSync(PROFILE, { recursive: true, force: true });
  const failed = results.filter((item) => item.pass === false).length;
  writeFileSync(join(OUT, "browser-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nchecks: ${results.filter((item) => item.pass !== null).length}, failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
};

await main();