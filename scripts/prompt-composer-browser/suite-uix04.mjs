/**
 * UIX04 in a real browser: the basic generation path, the folded settings, and the move to a
 * blocked field.
 *
 * This block adds no contract. Every claim is about the *display* layer sitting on top of the
 * request contract that already existed, so the assertions fall into four groups:
 *
 * 1. **The basic path is the one you see.** Presets, resolution, quantity and the button are
 *    visible with Steps/CFG/Seed folded, and the summary line states the values the next request
 *    will carry.
 * 2. **Folding is view state.** Folding and unfolding must not change a value, must not send
 *    `/prompt/compose`, and must not create a job. Where a preset is pressed or a field is
 *    edited, the *request body* is inspected instead of trusting the DOM.
 * 3. **One list blocks.** The inline reason, the field's `aria-invalid` and the disabled button
 *    all describe the same issue, and moving to a folded field opens the fold before focusing —
 *    a `hidden` subtree cannot take focus, so doing it in one commit would move nothing.
 * 4. **Server errors stay apart.** A refusal from the API keeps using `.errorbox`; only input
 *    problems appear next to the button.
 *
 * No request is stubbed except `/models` (to give a model a CFG-dependent negative limit), so
 * every body inspected here is the body the app really sends to the fake engine.
 */
import { openBuilder } from "./ui.mjs";

/** Every `POST /api/v1/jobs` body, in order. Installed once, never reloaded away. */
const CAPTURE = `(() => {
  if (window.__uix04Capture) return true;
  window.__uix04Capture = true;
  window.__uix04Bodies = [];
  window.__uix04Calls = { compose: 0, jobs: 0 };
  const real = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/prompt/compose")) window.__uix04Calls.compose += 1;
    if (url.includes("/api/v1/jobs") && init && init.method === "POST") {
      window.__uix04Calls.jobs += 1;
      try { window.__uix04Bodies.push(JSON.parse(init.body)); } catch { /* ignore */ }
    }
    return real(input, init);
  };
  return true;
})()`;

const STATE = `(() => {
  const text = (node) => (node ? node.textContent.trim() : null);
  const visible = (node) => !!node && node.getBoundingClientRect().height > 0;
  const region = document.querySelector('#prompt-settings');
  const toggle = document.querySelector('.prompt-settings__toggle');
  const blocker = document.querySelector('.generate-blocker');
  return {
    folded: !!region && region.hidden,
    regionVisible: visible(region),
    toggleExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
    toggleText: text(toggle),
    summary: text(document.querySelector('.prompt-settings__summary')),
    steps: document.querySelector('#prompt-steps')?.value ?? null,
    cfg: document.querySelector('#prompt-cfg')?.value ?? null,
    seed: document.querySelector('#prompt-seed')?.value ?? null,
    resolution: document.querySelector('#prompt-resolution')?.value ?? null,
    batch: document.querySelector('#prompt-batch')?.value ?? null,
    preset: text(document.querySelector('.chips .selected')),
    generateDisabled: document.querySelector('button.generate')?.disabled ?? null,
    generateLabel: text(document.querySelector('button.generate')),
    blocker: blocker ? text(blocker.querySelector('.generate-blocker__text')) : null,
    blockerField: blocker ? blocker.getAttribute('data-field') : null,
    seedInvalid: document.querySelector('#prompt-seed')?.getAttribute('aria-invalid') ?? null,
    active: (() => {
      const node = document.activeElement;
      return node ? { id: node.id || null, tag: node.tagName } : null;
    })(),
  };
})()`;

/** The last captured job body. */
const LAST_BODY = `(window.__uix04Bodies[window.__uix04Bodies.length - 1] ?? null)`;

/** Presses a preset by its visible label, which is also its key in the fixture. */
async function pressPreset(page, name) {
  const clicked = await page.evaluate(`(() => {
    const node = [...document.querySelectorAll('.chips button')]
      .find((item) => (item.textContent || '').trim().startsWith(${JSON.stringify(name)}));
    if (!node) return false;
    node.scrollIntoView({ block: 'center' });
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`preset not found: ${name}`);
}


/**
 * `/models`, rewritten so the fixture has the three facts this block needs:
 *
 * - **distinct presets.** All four fixture presets are `steps: 1, cfg: 1.0`, so pressing
 *   `quality` and `balanced` would produce the same body and a preset test could pass without
 *   the preset doing anything. Here they differ in Steps and CFG, which is what makes
 *   "the body carries the preset's values" an assertion with content.
 * - **a CFG-dependent negative.** `requires.cfg_scale: [7]` is the same contract the app already
 *   reads for `negativeEnabled`; giving it a value the presets actually reach means the negative
 *   field visibly turns on and off, instead of being asserted through component internals.
 * - **unchanged resolutions and parameters**, so nothing about the accepted ranges moves.
 *
 * Applied to the response rather than persisted across a reload: the block reloads first and
 * installs this afterwards, so there is no flag to survive a navigation and no stale stub.
 */
async function installFixture(page) {
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = window.fetch;
    const presets = {
      fast:     { width: 512, height: 512, steps: 2,  cfg_scale: 1.0 },
      balanced: { width: 512, height: 512, steps: 6,  cfg_scale: 3.5 },
      quality:  { width: 512, height: 512, steps: 24, cfg_scale: 7.0 },
    };
    const json = (body, status) => new Response(JSON.stringify(body), { status,
      headers: { "Content-Type": "application/json" } });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (/\\/models$/.test(url)) {
        const response = await real(input, init);
        const body = await response.json().catch(() => null);
        if (!Array.isArray(body)) return json(body, response.status);
        for (const model of body) {
          model.presets = JSON.parse(JSON.stringify(presets));
          const option = model.generation_options?.negative_prompt;
          if (option) {
            model.generation_options.negative_prompt = {
              ...option, mode: "verified", requires: { cfg_scale: [7] },
            };
          }
        }
        return json(body, response.status);
      }
      return real(input, init);
    };
  })();` });
}


/**
 * Runs the UIX04 block.
 *
 * It reloads first, for two reasons: the fixture has to be in place before the app's first
 * `/models` call, and earlier blocks leave the composer with candidates, chips and a model of
 * their own that would make "the basic path" describe their leftovers rather than a fresh visit.
 */
export async function runUix04({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select, press } = page;

  await installFixture(page);
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "uix04 models", timeout: 30000 });
  await sleep(500);
  await evaluate(CAPTURE);
  await select(".composer select", "fake-sd15");
  await sleep(500);

  // ── A. the basic path is what is visible, the details are folded ─────────────
  const fresh = await evaluate(STATE);
  check("UIX04 · 세부 설정은 기본 접힘", true, fresh.folded);
  check("UIX04 · 접힌 영역은 화면에 없음", false, fresh.regionVisible);
  check("UIX04 · 토글은 접힘을 알림", "false", fresh.toggleExpanded);
  check("UIX04 · 토글 이름이 세부 설정임을 말함", true, (fresh.toggleText || "").includes("세부 생성 설정"));
  // Everything the default path needs is outside the fold.
  const basic = await evaluate(`(() => {
    const shown = (selector) => {
      const node = document.querySelector(selector);
      return !!node && node.getBoundingClientRect().height > 0;
    };
    return {
      finalPrompt: shown('#prompt-final'),
      negative: shown('#prompt-negative'),
      presets: document.querySelectorAll('.chips button').length,
      presetsShown: shown('.chips'),
      resolution: shown('#prompt-resolution'),
      batch: shown('#prompt-batch'),
      generate: shown('button.generate'),
    };
  })()`);
  check("UIX04 · 최종 프롬프트가 기본 경로에 있음", true, basic.finalPrompt);
  check("UIX04 · Negative가 기본 경로에 있음", true, basic.negative);
  check("UIX04 · 프리셋 버튼 3개가 보임", true, basic.presets === 3 && basic.presetsShown);
  check("UIX04 · 해상도·수량이 기본 경로에 있음", true, basic.resolution && basic.batch);
  check("UIX04 · 생성 버튼이 보임", true, basic.generate);
  // The summary is what keeps the fold honest, so it must be readable while folded.
  check("UIX04 · 접힌 채로 현재 값 요약이 보임", true,
    fresh.summary === `Steps ${fresh.steps} · CFG ${fresh.cfg} · Seed ${fresh.seed}`);
  record("UIX04 기본 상태", JSON.stringify({ ...fresh, basic }));
  await evaluate(`document.querySelector('.prompt-settings__row')?.scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await page.shot(shots, "uix04-01-default-folded.png");


  // ── B. folding and unfolding is view state only ─────────────────────────────
  // The task's contract in one sequence: edit inside the fold, close it, reopen it, and require
  // the same values, the same summary and no request of either kind.
  await click(".prompt-settings__toggle");
  await waitFor(`document.querySelector('.prompt-settings__toggle')?.getAttribute('aria-expanded') === 'true'`,
    { label: "settings open" });
  await sleep(250);
  const opened = await evaluate(STATE);
  check("UIX04 · 펼치면 영역이 보임", true, opened.regionVisible);
  check("UIX04 · 펼치면 토글이 펼침을 알림", "true", opened.toggleExpanded);
  check("UIX04 · 펼쳐도 요약은 그대로", fresh.summary, opened.summary);
  await evaluate(`document.querySelector('#prompt-settings')?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix04-02-details-open.png");

  // A manual edit inside the fold, then two folds: the edit must survive both.
  await typeInto("#prompt-steps", "17");
  await typeInto("#prompt-cfg", "4.5");
  await typeInto("#prompt-seed", "4242");
  await sleep(250);
  const edited = await evaluate(STATE);
  check("UIX04 · 수동 수정이 요약에 즉시 반영됨", "Steps 17 · CFG 4.5 · Seed 4242", edited.summary);
  const callsBeforeFold = await evaluate(`({ ...window.__uix04Calls })`);

  await click(".prompt-settings__toggle");
  await waitFor(`document.querySelector('#prompt-settings')?.hidden === true`, { label: "settings closed" });
  await sleep(250);
  const refolded = await evaluate(STATE);
  check("UIX04 · 접어도 Steps 보존", "17", refolded.steps);
  check("UIX04 · 접어도 CFG 보존", "4.5", refolded.cfg);
  check("UIX04 · 접어도 Seed 보존", "4242", refolded.seed);
  check("UIX04 · 접어도 요약 보존", edited.summary, refolded.summary);

  await click(".prompt-settings__toggle");
  await waitFor(`document.querySelector('#prompt-settings')?.hidden === false`, { label: "settings reopened" });
  await sleep(250);
  const reopened = await evaluate(STATE);
  check("UIX04 · 다시 펼쳐도 Steps 보존", "17", reopened.steps);
  check("UIX04 · 다시 펼쳐도 CFG 보존", "4.5", reopened.cfg);
  check("UIX04 · 다시 펼쳐도 Seed 보존", "4242", reopened.seed);
  const callsAfterFold = await evaluate(`({ ...window.__uix04Calls })`);
  check("UIX04 · 접기·펼치기로 compose 요청 없음", callsBeforeFold.compose, callsAfterFold.compose);
  check("UIX04 · 접기·펼치기로 생성 요청 없음", callsBeforeFold.jobs, callsAfterFold.jobs);
  record("UIX04 접기·펼치기", JSON.stringify({ folded: refolded, reopened, callsAfterFold }));

  // ── C. a preset fills the values, and the body carries them ─────────────────
  // The fixture gives the presets distinct Steps/CFG, so this cannot pass by accident.
  await pressPreset(page, "quality");
  await sleep(300);
  const afterPreset = await evaluate(STATE);
  check("UIX04 · 프리셋이 Steps를 채움", "24", afterPreset.steps);
  check("UIX04 · 프리셋이 CFG를 채움", "7", afterPreset.cfg);
  check("UIX04 · 프리셋이 선택으로 표시됨", true, (afterPreset.preset || "").includes("quality"));
  check("UIX04 · 프리셋 값이 요약에 반영됨", "Steps 24 · CFG 7 · Seed 4242", afterPreset.summary);
  // The seed is the user's own, and a preset must not touch it.
  check("UIX04 · 프리셋이 Seed를 바꾸지 않음", "4242", afterPreset.seed);

  // Manual edits after the preset, then a fold, then submit: the *body* is the assertion.
  await typeInto("#prompt-steps", "31");
  await typeInto("#prompt-cfg", "5.5");
  await sleep(200);
  const afterManual = await evaluate(STATE);
  check("UIX04 · 수동 수정이 프리셋 값을 덮어씀", "Steps 31 · CFG 5.5 · Seed 4242", afterManual.summary);
  await click(".prompt-settings__toggle");
  await sleep(250);
  check("UIX04 · 제출 전 접힘", true, (await evaluate(STATE)).folded);

  await typeInto("#prompt-final", "a preset then edited run");
  await select("#prompt-resolution", "768x768");
  await typeInto("#prompt-batch", "3");
  await sleep(300);
  const beforeSubmit = await evaluate(`({ ...${STATE}, bodies: window.__uix04Bodies.length })`);
  check("UIX04 · 제출 준비 완료", false, beforeSubmit.generateDisabled);
  await click("button.generate");
  await sleep(1500);
  const body = await evaluate(LAST_BODY);
  check("UIX04 · 요청이 생성됨", true, !!body);
  check("UIX04 · 본문 Steps가 수동 수정값", 31, body?.steps);
  check("UIX04 · 본문 CFG가 수동 수정값", 5.5, body?.cfg_scale);
  check("UIX04 · 본문 Seed가 입력값", 4242, body?.seed);
  check("UIX04 · 본문 해상도가 선택값", 768, body?.width);
  check("UIX04 · 본문 높이도 선택값", 768, body?.height);
  check("UIX04 · 본문 수량이 입력값", 3, body?.batch_count);
  check("UIX04 · 수량 3이면 batch 작업", "image.batch", body?.job_type);
  check("UIX04 · 본문 프리셋 이름 유지", "quality", body?.preset);
  record("UIX04 프리셋·수동 수정 제출", JSON.stringify({ afterPreset, body }));



  // ── D. a bad seed blocks, names the field, and unfolds before focusing ──────
  // The fold is *closed* first, so the move has to open it: a control inside a `hidden` subtree
  // cannot take focus, and "nothing happened" is exactly the failure this asserts against.
  const foldedBeforeSeed = await evaluate(STATE);
  check("UIX04 · Seed 오류 전 접힘", true, foldedBeforeSeed.folded);
  await typeInto("#prompt-seed", "-5");
  await sleep(300);
  const seedBlocked = await evaluate(STATE);
  check("UIX04 · 잘못된 Seed가 생성을 막음", true, seedBlocked.generateDisabled);
  check("UIX04 · 막힌 이유가 버튼 옆에 있음", "seed", seedBlocked.blockerField);
  check("UIX04 · 막힌 이유가 Seed를 지목함", true, (seedBlocked.blocker || "").includes("Seed"));
  check("UIX04 · 접힌 상태에서 펼침을 예고함", true, (seedBlocked.blocker || "").includes("펼칩니다"));
  check("UIX04 · Seed 필드가 무효로 표시됨", "true", seedBlocked.seedInvalid);
  await evaluate(`document.querySelector('.generate-blocker')?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix04-03-seed-blocked.png");

  const callsBeforeMove = await evaluate(`({ ...window.__uix04Calls })`);
  await click(".generate-blocker button");
  await waitFor(`document.querySelector('#prompt-settings')?.hidden === false`, { label: "seed move unfolds" });
  await sleep(350);
  const moved = await evaluate(STATE);
  check("UIX04 · 이동이 접힌 세부 설정을 펼침", false, moved.folded);
  check("UIX04 · 이동이 Seed 필드에 포커스를 둠", "prompt-seed", moved.active?.id);
  check("UIX04 · 이동이 값을 바꾸지 않음", "-5", moved.seed);
  const callsAfterMove = await evaluate(`({ ...window.__uix04Calls })`);
  check("UIX04 · 이동이 요청을 만들지 않음", JSON.stringify(callsBeforeMove), JSON.stringify(callsAfterMove));
  await evaluate(`document.querySelector('#prompt-settings')?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix04-04-seed-focused.png");

  // Fixing the field clears the line with no extra step: one list, one verdict.
  await typeInto("#prompt-seed", "99");
  await sleep(300);
  const fixed = await evaluate(STATE);
  check("UIX04 · 수정하면 막힘 표시가 사라짐", null, fixed.blocker);
  check("UIX04 · 수정하면 무효 표시도 사라짐", "false", fixed.seedInvalid);
  check("UIX04 · 수정하면 생성 가능", false, fixed.generateDisabled);
  check("UIX04 · 수정한 Seed가 요약에 반영됨", "Steps 31 · CFG 5.5 · Seed 99", fixed.summary);
  // And the corrected value is what the next request carries.
  const bodiesBefore = await evaluate(`window.__uix04Bodies.length`);
  await click("button.generate");
  await sleep(1200);
  const fixedBody = await evaluate(LAST_BODY);
  check("UIX04 · 오류 수정 후 정상 제출", bodiesBefore + 1,
    await evaluate(`window.__uix04Bodies.length`));
  check("UIX04 · 수정한 Seed가 본문에 실림", 99, fixedBody?.seed);
  record("UIX04 Seed 오류", JSON.stringify({ seedBlocked, moved, fixed, fixedBody }));

  // ── E. an empty final prompt blocks, and the move lands in the textarea ─────
  await typeInto("#prompt-final", "");
  await sleep(300);
  const emptyBlocked = await evaluate(STATE);
  check("UIX04 · 빈 최종 프롬프트가 생성을 막음", true, emptyBlocked.generateDisabled);
  check("UIX04 · 막힌 이유가 최종 프롬프트를 지목함", "prompt", emptyBlocked.blockerField);
  // A blank field that was never touched is a hint, not an error; once emptied by the user it is
  // reported, because they did it. `promptDirty` is what distinguishes the two.
  check("UIX04 · 사용자가 비운 필드는 이유를 표시함", true, (emptyBlocked.blocker || "").includes("최종 프롬프트"));
  const callsBeforePromptMove = await evaluate(`({ ...window.__uix04Calls })`);
  await click(".generate-blocker button");
  await sleep(350);
  const promptMoved = await evaluate(STATE);
  check("UIX04 · 최종 프롬프트로 포커스 이동", "prompt-final", promptMoved.active?.id);
  check("UIX04 · 이동이 최종 입력을 바꾸지 않음", "", await evaluate(`document.querySelector('#prompt-final').value`));
  check("UIX04 · 이동이 요청을 만들지 않음",
    JSON.stringify(callsBeforePromptMove), JSON.stringify(await evaluate(`({ ...window.__uix04Calls })`)));
  await evaluate(`document.querySelector('#prompt-final')?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix04-05-prompt-blocked.png");
  await typeInto("#prompt-final", "a lantern in the dark");
  await sleep(300);
  check("UIX04 · 프롬프트를 채우면 막힘이 풀림", null, (await evaluate(STATE)).blocker);

  // ── F. the CFG-dependent negative limit follows the existing contract ───────
  // The fixture ties `negative_prompt` to CFG 7, which only the `quality` preset reaches. So the
  // limit is exercised by pressing presets and reading the field, not by reaching into state.
  await pressPreset(page, "quality");
  await sleep(350);
  const negativeOn = await evaluate(`(() => {
    const field = document.querySelector('#prompt-negative');
    return { disabled: field?.disabled ?? null, note: document.querySelector('.option-note')?.textContent ?? null };
  })()`);
  check("UIX04 · CFG 7에서 Negative 사용 가능", false, negativeOn.disabled);
  check("UIX04 · CFG 조건이 Negative 옆에 안내됨", true, (negativeOn.note || "").includes("CFG 7"));
  await typeInto("#prompt-negative", "blurry, text");
  await sleep(250);
  check("UIX04 · Negative 입력이 유지됨", "blurry, text",
    await evaluate(`document.querySelector('#prompt-negative').value`));
  await evaluate(`document.querySelector('.option-note')?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix04-06-negative-note.png");

  // Dropping CFG below the requirement clears the field, exactly as it did before UIX04.
  await typeInto("#prompt-cfg", "2.5");
  await sleep(350);
  const negativeOff = await evaluate(`(() => {
    const field = document.querySelector('#prompt-negative');
    return { disabled: field?.disabled ?? null, value: field?.value ?? null };
  })()`);
  check("UIX04 · CFG 2.5에서 Negative 비활성", true, negativeOff.disabled);
  check("UIX04 · 계약대로 Negative 값이 비워짐", "", negativeOff.value);
  await typeInto("#prompt-cfg", "7");

  // ── G. a server refusal stays in the error box, not next to the button ──────
  // `blocking` is only ever client-side. A 413 is the server's answer and cannot be fixed by
  // moving to a field, so it must not appear as a "move here" line.
  await typeInto("#prompt-final", "a server refusal probe");
  await sleep(300);
  const beforeRefusal = await evaluate(`({ ...${STATE}, bodies: window.__uix04Bodies.length })`);
  check("UIX04 · 서버 오류 직전 제출 가능", false, beforeRefusal.generateDisabled);
  await evaluate(`(() => {
    if (window.__uix04RealFetch) return true;
    window.__uix04RealFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/v1/jobs') && init && init.method === 'POST' && window.__uix04Refuse) {
        return Promise.resolve(new Response(
          JSON.stringify({ detail: 'Prompt composition exceeds 32 KiB' }),
          { status: 413, headers: { 'Content-Type': 'application/json' } }));
      }
      return window.__uix04RealFetch(input, init);
    };
    return true;
  })()`);
  await evaluate(`window.__uix04Refuse = true;`);
  await click("button.generate");
  await waitFor(`!!document.querySelector('.errorbox')`, { label: "server refusal", timeout: 10000 });
  await sleep(300);
  const refused = await evaluate(`(() => ({
    ...${STATE},
    errorBox: document.querySelector('.errorbox')?.textContent?.trim() ?? null,
    prompt: document.querySelector('#prompt-final').value,
  }))()`);
  check("UIX04 · 서버 오류가 오류 상자에 표시됨", true, (refused.errorBox || "").includes("32 KiB"));
  check("UIX04 · 서버 오류는 버튼 옆에 붙지 않음", null, refused.blocker);
  check("UIX04 · 서버 오류 뒤 입력 보존", "a server refusal probe", refused.prompt);
  check("UIX04 · 서버 오류 뒤 재시도 가능", false, refused.generateDisabled);
  await evaluate(`document.querySelector('.errorbox button')?.click(); window.__uix04Refuse = false;`);
  await sleep(250);

  // ── H. repeated clicks still make one job ──────────────────────────────────
  const jobsBeforeClick = await evaluate(`window.__uix04Calls.jobs`);
  await evaluate(`(() => {
    const button = document.querySelector('button.generate');
    button.click(); button.click(); button.click();
    return true;
  })()`);
  await sleep(1500);
  const jobsAfterClick = await evaluate(`window.__uix04Calls.jobs`);
  check("UIX04 · 연속 클릭이 한 건만 접수", jobsBeforeClick + 1, jobsAfterClick);
  record("UIX04 중복 클릭", JSON.stringify({ jobsBeforeClick, jobsAfterClick }));

  // ── I. a model change keeps the settings contract ──────────────────────────
  // Pressing a model is a settings change, not a view change: the fold selection is UI state
  // and must survive it. But the values become the new model's, so the summary must follow.
  // The fold was opened by the move in §D and nothing since closed it; assert that rather
  // than toggling, or the check below would be testing the toggle instead.
  const openBeforeChange = await evaluate(STATE);
  check("UIX04 · 모델 변경 전 세부 설정은 펼침", false, openBeforeChange.folded);
  await select(".composer select", "fake-flux2");
  await sleep(600);
  const switched = await evaluate(STATE);
  check("UIX04 · 모델 변경 후에도 펼침 상태 유지", false, switched.folded);
  check("UIX04 · 모델 변경 후 요약이 새 모델 값을 반영", true,
    (switched.summary || "").startsWith(`Steps ${switched.steps} · CFG ${switched.cfg} · Seed`));
  check("UIX04 · 모델 변경 후 프리셋 표시가 하나", true, !!switched.preset);
  await select(".composer select", "fake-sd15");
  await sleep(600);

  // Back on sd15, the switch reset CFG to the model default, so the negative field must be off
  // again — and reaching CFG 7 must turn it back on. The fold is still open from above.
  await typeInto("#prompt-cfg", "7");
  await sleep(350);
  check("UIX04 · CFG 7로 돌아오면 다시 사용 가능", false,
    await evaluate(`document.querySelector('#prompt-negative').disabled`));
  record("UIX04 Negative 계약", JSON.stringify({ negativeOn, negativeOff }));

  // ── J. the four required states at both widths ─────────────────────────────
  // Each shot is set up explicitly rather than inherited, because a screenshot that happens to
  // follow another state is not evidence about *this* one. The detail values are normalised to
  // one baseline (a preset press plus a fresh seed, both real user paths) so the two widths
  // document the *same* default rather than whatever the previous iteration left behind.
  for (const [width, height, label] of [[360, 800, "360"], [390, 844, "390"], [1280, 900, "1280"]]) {
    await page.viewport(width, height, width < 500);
    await sleep(400);
    // Start from the default path: folded details, a real prompt, no blocker.
    await typeInto("#prompt-final", `layout probe at ${label}`);
    await sleep(250);
    if (!(await evaluate(`document.querySelector('#prompt-settings')?.hidden === true`))) {
      await click(".prompt-settings__toggle");
      await waitFor(`document.querySelector('#prompt-settings')?.hidden === true`, { label: `fold ${label}` });
    }
    await pressPreset(page, "balanced");
    await sleep(300);
    // The seed box lives inside the folded region, but `hidden` keeps it mounted, so it can be
    // edited without unfolding — which is exactly the behaviour this round is about.
    await typeInto("#prompt-seed", "-1");
    await sleep(300);

    const layout = await evaluate(`(() => {
      const doc = document.documentElement;
      const toggle = document.querySelector('.prompt-settings__toggle');
      const generate = document.querySelector('button.generate');
      const summary = document.querySelector('.prompt-settings__summary');
      const chips = [...document.querySelectorAll('.chips button')];
      const rect = (node) => node ? node.getBoundingClientRect() : null;
      const box = rect(toggle);
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        toggleHeight: box ? Math.round(box.height) : 0,
        toggleInside: !!box && box.right <= doc.clientWidth + 1 && box.left >= -1,
        generateHeight: rect(generate) ? Math.round(rect(generate).height) : 0,
        summaryHeight: rect(summary) ? Math.round(rect(summary).height) : 0,
        summaryInside: !!rect(summary) && rect(summary).right <= doc.clientWidth + 1,
        presetBelow44: chips.filter((node) => node.getBoundingClientRect().height < 44).length,
        regionVisible: !document.querySelector('#prompt-settings')?.hidden,
      };
    })()`);
    check(`UIX04 · ${label} 기본 상태 가로 넘침 없음`, true, layout.overflow <= 1);
    check(`UIX04 · ${label} 토글 44px 이상`, true, layout.toggleHeight >= 44);
    check(`UIX04 · ${label} 토글이 화면 안`, true, layout.toggleInside);
    check(`UIX04 · ${label} 요약이 화면 안`, true, layout.summaryInside);
    check(`UIX04 · ${label} 요약이 읽히는 높이`, true, layout.summaryHeight > 0);
    check(`UIX04 · ${label} 생성 버튼 44px 이상`, true, layout.generateHeight >= 44);
    check(`UIX04 · ${label} 프리셋 44px 이상`, 0, layout.presetBelow44);
    check(`UIX04 · ${label} 접힌 상태 재현`, false, layout.regionVisible);
    record(`UIX04 ${label} 기본`, JSON.stringify(layout));
    await evaluate(`document.querySelector('.prompt-settings__row')?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    await page.shot(shots, `uix04-07-default-${label}.png`);

    // (2) details unfolded.
    await click(".prompt-settings__toggle");
    await waitFor(`document.querySelector('#prompt-settings')?.hidden === false`, { label: `open ${label}` });
    await sleep(350);
    const openedLayout = await evaluate(`(() => {
      const doc = document.documentElement;
      const inputs = ['#prompt-steps', '#prompt-cfg', '#prompt-seed'].map((selector) => {
        const node = document.querySelector(selector);
        const box = node ? node.getBoundingClientRect() : null;
        return { present: !!node, height: box ? Math.round(box.height) : 0,
          inside: !!box && box.right <= doc.clientWidth + 1 };
      });
      return { overflow: doc.scrollWidth - doc.clientWidth, inputs };
    })()`);
    check(`UIX04 · ${label} 펼친 상태 가로 넘침 없음`, true, openedLayout.overflow <= 1);
    check(`UIX04 · ${label} 세 입력이 모두 화면 안`, true,
      openedLayout.inputs.every((entry) => entry.present && entry.height > 0 && entry.inside));
    await evaluate(`document.querySelector('#prompt-settings')?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    await page.shot(shots, `uix04-08-details-${label}.png`);

    // (3) a bad seed: the blocking line and the field it names.
    await typeInto("#prompt-seed", "-3");
    await sleep(350);
    const blocked = await evaluate(STATE);
    check(`UIX04 · ${label} Seed 오류로 막힘`, "seed", blocked.blockerField);
    await evaluate(`document.querySelector('.generate-blocker')?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    await page.shot(shots, `uix04-09-seed-error-${label}.png`);
    await click(".generate-blocker button");
    await sleep(400);
    const afterMove = await evaluate(STATE);
    check(`UIX04 · ${label} 이동 후 Seed 포커스`, "prompt-seed", afterMove.active?.id);
    await typeInto("#prompt-seed", "1234");
    await sleep(300);

    // (4) the CFG-dependent negative note.
    await pressPreset(page, "quality");
    await sleep(350);
    const negativeNote = await evaluate(`(() => {
      const note = document.querySelector('.option-note');
      const box = note ? note.getBoundingClientRect() : null;
      return { text: note?.textContent ?? null, inside: !!box && box.right <= document.documentElement.clientWidth + 1,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    })()`);
    check(`UIX04 · ${label} Negative 제한 안내가 화면 안`, true, negativeNote.inside);
    check(`UIX04 · ${label} Negative 안내에서 가로 넘침 없음`, true, negativeNote.overflow <= 1);
    check(`UIX04 · ${label} Negative 안내가 CFG 조건을 말함`, true, (negativeNote.text || "").includes("CFG 7"));
    await evaluate(`document.querySelector('.option-note')?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    await page.shot(shots, `uix04-10-negative-${label}.png`);
    await typeInto("#prompt-cfg", "2.5");
    await sleep(300);
  }
  await page.viewport(1280, 900, false);
  await sleep(300);

  // ── K. the fold is operable from the keyboard alone ────────────────────────
  // A real Tab/Enter path, not `.focus()`: the claim is that a keyboard user can reach and
  // operate the disclosure, which a programmatic focus would not prove.
  //
  // The fold must be *closed* for this: while it is open, Tab from 해상도 walks the three
  // inputs inside it first, so the toggle is not the next stop. That is correct reading
  // order, not a defect — the check below pins the closed state and asserts the next stop.
  if (!(await evaluate(`document.querySelector('#prompt-settings')?.hidden === true`))) {
    await click(".prompt-settings__toggle");
    await waitFor(`document.querySelector('#prompt-settings')?.hidden === true`, { label: "fold for keyboard" });
  }
  await evaluate(`document.querySelector('#prompt-resolution').focus()`);
  // 해상도 and 수량 share the `.grid2` row, so the toggle is the *second* stop from 해상도.
  // Asserting the exact stop (rather than tabbing until something matches) is what proves the
  // disclosure is in the natural reading order and not merely reachable.
  await press("Tab", "Tab", 9);
  await sleep(120);
  const afterOneTab = await evaluate(`document.activeElement?.id ?? null`);
  await press("Tab", "Tab", 9);
  await sleep(150);
  const tabbed = await evaluate(`(() => ({
    cls: document.activeElement?.className ?? null,
    expanded: document.activeElement?.getAttribute('aria-expanded') ?? null,
  }))()`);
  check("UIX04 · 해상도 다음 Tab은 수량", "prompt-batch", afterOneTab);
  check("UIX04 · 수량 다음 Tab이 세부 설정 토글", true,
    (tabbed.cls || "").includes("prompt-settings__toggle"));
  const expandedBefore = tabbed.expanded;
  await press("Enter", "Enter", 13);
  await sleep(350);
  const toggled = await evaluate(`(() => ({
    expanded: document.querySelector('.prompt-settings__toggle')?.getAttribute('aria-expanded') ?? null,
    focused: document.activeElement === document.querySelector('.prompt-settings__toggle'),
    visible: !document.querySelector('#prompt-settings')?.hidden,
  }))()`);
  check("UIX04 · Enter로 펼침이 바뀜", true, toggled.expanded !== expandedBefore);
  check("UIX04 · 펼친 뒤 포커스가 토글에 남음", true, toggled.focused);
  check("UIX04 · 펼친 뒤 영역이 보임", true, toggled.visible);
  await press("Enter", "Enter", 13);
  await sleep(300);
  record("UIX04 키보드", JSON.stringify({ tabbed, toggled }));
}
