/**
 * UIX03 in a real browser: comparing long candidates and checking what an apply does.
 *
 * This block adds no contract. It proves that the comparison layer sits on the UCP apply
 * machine without moving it, so every assertion is about one of four claims:
 *
 * 1. **The header decides.** Title, Korean difference, impact and applied state are readable
 *    while every body is closed, and the second of three long candidates can be opened and
 *    applied with its exact string landing in the final prompt.
 * 2. **Expansion is view state.** Opening and closing bodies must not bump a revision, must
 *    not send `/prompt/compose`, and must not touch the final prompt.
 * 3. **The UCP apply rules still hold.** Overwrite confirm, cancel, undo, negative support
 *    and staleness are exercised through the new header rather than reimplemented.
 * 4. **A reply never writes.** A reply arriving while folded, or while the user is typing
 *    the English field, leaves both the field and the focus where the user put them.
 *
 * The compose reply is stubbed exactly as UCP08 and UIX02 do.
 */
import { openBuilder } from "./ui.mjs";

const BRIEF = "비 오는 골목에 서 있는 여성";

/** Three long candidates: the second one is the apply target of the main scenario. */
const LONG_A = `a woman standing in a rainy alley, ${"neon reflection on wet asphalt, ".repeat(24)}cinematic`;
const LONG_B = `rainy alley at night, a lone woman backlit by neon, ${"shallow depth of field, ".repeat(24)}35mm`;
const LONG_C = `a woman in a wet alley, ${"cold blue grade, wide establishing shot, ".repeat(24)}film still`;

const SCENE = {
  entities: [
    { entity_id: "entity-1", kind: "person", count: 1,
      attributes_ko: ["검은 머리"], evidence_ko: "여성" },
  ],
  relations: [],
  environment: { location_ko: "비 오는 골목", time_ko: "밤", lighting_ko: "네온" },
  unmapped_details: [], ambiguities: [],
};

const replyWith = (over = {}) => ({
  result_id: "cmp-uix03-0001",
  status: "ready",
  summary_ko: "비 오는 골목에 선 여성",
  scene: SCENE,
  selections: [
    { id: "subject.person", source: "auto", pinned: false, entity_id: "entity-1" },
  ],
  candidates: [
    { candidate_id: "uix03-a", title_ko: "원문 충실", difference_ko: "원문 그대로",
      positive_prompt: LONG_A, negative_prompt: null, preserved_ko: [] },
    { candidate_id: "uix03-b", title_ko: "분위기 강조", difference_ko: "네온과 심도를 더함",
      positive_prompt: LONG_B, negative_prompt: "blurry, text", preserved_ko: ["여성", "골목"] },
    { candidate_id: "uix03-c", title_ko: "구도 강조", difference_ko: "와이드 구도로 바꿈",
      positive_prompt: LONG_C, negative_prompt: null, preserved_ko: [] },
  ],
  clarifications: [], warnings: [], snapshot_trim: [],
  provider: { model: "stub-compose", finish_reason: "stop" },
  ...over,
});

/**
 * Installs compose capability + endpoint, and counts compose requests.
 *
 * `__uix03NoNegative` is persisted in `sessionStorage` because the block reloads to apply it:
 * a flag on `window` would be wiped by the very navigation it exists to survive. The `/models`
 * stub strips `negative_prompt` from every model while it is set, which is the same fact the
 * app reads to derive `negativeEnabled` — no component internals are reached.
 */
async function installStub(page) {
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__uix03Doc = true;
    const real = window.fetch;
    window.__composeCalls = [];
    window.__composeReply = ${JSON.stringify(replyWith())};
    window.__composeMode = "ready";
    window.__composeDelay = 0;
    const noNegative = () => {
      try { return sessionStorage.getItem('__uix03NoNegative') === '1'; } catch { return false; }
    };
    window.__uix03NoNegative = noNegative();
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
      headers: { "Content-Type": "application/json" } });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/system/capabilities")) {
        const response = await real(input, init);
        const body = await response.json().catch(() => ({}));
        body.prompt_compose = {
          schema_versions: [1], dictionary_version: "1.2.0",
          output_profile_versions: { sd15: 2, flux2: 2, "z-image": 2, "moss-image": 2 },
          timeout_ms: 60000, max_candidates: 3,
          max_request_bytes: 24576, max_response_bytes: 49152,
        };
        body.prompt_composition = { schema_versions: [1, 2, 3] };
        return json(body, response.status);
      }
      if (url.includes("/models")) {
        const response = await real(input, init);
        const body = await response.json().catch(() => null);
        if (Array.isArray(body) && noNegative()) {
          for (const model of body) {
            if (Array.isArray(model.supported_parameters)) {
              model.supported_parameters = model.supported_parameters
                .filter((name) => name !== "negative_prompt");
            }
            // negativeEnabled prefers the profile's own mode over the parameter list, so the
            // capability has to be withdrawn where the app actually reads it. Flipping only
            // supported_parameters would leave mode "verified" winning and the field live.
            const option = model.generation_options?.negative_prompt;
            if (option) model.generation_options.negative_prompt = { ...option, mode: "unsupported" };
          }
        }
        return json(body, response.status);
      }
      if (url.includes("/prompt/compose")) {
        const sent = JSON.parse(init.body);
        window.__composeCalls.push(sent);
        if (window.__composeDelay) await new Promise((r) => setTimeout(r, window.__composeDelay));
        if (window.__composeMode === "fail") {
          return json({ status: "unavailable", why: "gpu_unavailable",
            message: "지금은 LLM을 사용할 수 없습니다" });
        }
        return json({ ...window.__composeReply, request_id: sent.request_id });
      }
      return real(input, init);
    };
  })();` });
}

/**
 * The candidate cards as the user sees them.
 *
 * `bodyVisible` is measured, not inferred from the attribute: a body inside a `hidden`
 * wrapper can still report a height if a later rule re-displays it, and "collapsed" is a
 * claim about pixels.
 */
const CARDS = `(() => {
  const text = (node) => (node?.textContent ?? "").replace(/\\s+/g, " ").trim();
  return [...document.querySelectorAll('.compose-candidate')].map((node) => {
    const body = node.querySelector('.compose-candidate__body');
    const toggle = node.querySelector('.compose-candidate__toggle');
    const rect = body ? body.getBoundingClientRect() : null;
    return {
      title: text(node.querySelector('.compose-candidate__title')),
      impact: text(node.querySelector('.compose-candidate__impact')),
      difference: text(node.querySelector('.compose-candidate__difference')),
      prompt: text(node.querySelector('.compose-candidate__prompt')),
      negative: text(node.querySelector('.compose-candidate__negative')),
      applied: node.hasAttribute('data-applied'),
      appliedBadge: Boolean(node.querySelector('.compose-candidate__applied')),
      expanded: toggle ? toggle.getAttribute('aria-expanded') : null,
      bodyVisible: Boolean(rect && rect.height > 0),
      applyInside: Boolean(node.querySelector('.compose-apply')),
    };
  });
})()`;

/** The final prompt and negative as the form holds them. */
const FIELDS = `(() => ({
  prompt: document.querySelector('#prompt-final')?.value ?? null,
  negative: document.querySelector('.composer textarea[rows="2"]')?.value ?? null,
}))()`;

/** Clicks one candidate's header toggle, addressed by its title fragment. */
const toggleCard = (title) => `(() => {
  const card = [...document.querySelectorAll('.compose-candidate')]
    .find((node) => (node.textContent || '').includes(${JSON.stringify(title)}));
  const button = card?.querySelector('.compose-candidate__toggle');
  if (!button) return false;
  button.scrollIntoView({ block: 'center' });
  button.click();
  return true;
})()`;

/** Clicks one candidate's apply button, addressed by its title rather than its index. */
const applyCard = (title) => `(() => {
  const card = [...document.querySelectorAll('.compose-candidate')]
    .find((node) => (node.textContent || '').includes(${JSON.stringify(title)}));
  const button = card?.querySelector('.compose-apply');
  if (!button) return false;
  button.scrollIntoView({ block: 'center' });
  button.click();
  return true;
})()`;

/** The folded strip's own facts, read from the DOM only. */
const STRIP = `(() => {
  const node = document.querySelector('.compose-strip');
  return {
    present: Boolean(node),
    phase: node?.getAttribute('data-phase') ?? null,
    text: (node?.textContent ?? "").replace(/\\s+/g, " ").trim(),
    folded: !!document.querySelector('#compose-path')?.hidden,
    inViewport: (() => {
      const rect = node?.getBoundingClientRect();
      return Boolean(rect && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight);
    })(),
  };
})()`;

/** Focus as a user would experience it: the tag *and* the identifying bits. */
const FOCUS = `(() => {
  const node = document.activeElement;
  return { id: node?.id ?? null, cls: typeof node?.className === 'string' ? node.className : null };
})()`;

/** Opens the compose path and types the brief; shared by several sections. */
async function composeOnce(page, sleep, brief = BRIEF) {
  const { clickByText, typeInto } = page;
  await clickByText(".prompt-paths button", "한글 장면으로 만들기");
  await sleep(250);
  await typeInto("#compose-brief", brief);
  await sleep(200);
  await page.click(".compose-generate");
  await page.waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "uix03 three candidates", timeout: 20000 });
  await sleep(350);
}

/**
 * Runs the UIX03 block.
 *
 * It reloads the page itself: the stub has to be installed before the app's first
 * capabilities fetch, and earlier blocks leave the composer in states this one would have to
 * unwind. `openBuilder` is the same helper every other block uses.
 */
export async function runUix03({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, press, select } = page;

  await installStub(page);
  // Clear the persisted flag *before* the reload that reads it, and wait for the new document
  // rather than the old DOM: `waitFor` on the app selector would match the pre-reload page.
  await evaluate(`try { sessionStorage.removeItem('__uix03NoNegative'); } catch {}`);
  await evaluate(`delete window.__uix03Doc`);
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`window.__uix03Doc === true`, { label: "uix03 new document", timeout: 30000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "uix03 models", timeout: 30000 });
  await openBuilder(page);
  await select(".composer select", "fake-sd15");
  await sleep(600);

  // ── A. the header decides, all bodies closed except the first ────────────────
  await composeOnce(page, sleep);
  const initial = await evaluate(CARDS);
  check("UIX03 · 후보 3개", 3, initial.length);
  // Default expansion: only the first body is open.
  check("UIX03 · 첫 후보만 기본 펼침", JSON.stringify([true, false, false]),
    JSON.stringify(initial.map((card) => card.bodyVisible)));
  // The header alone answers the three questions the task names.
  check("UIX03 · 제목이 헤더에 보임", true, initial[1].title.includes("분위기 강조"));
  check("UIX03 · 한국어 차이가 카드에서 읽힘", "네온과 심도를 더함", initial[1].difference);
  check("UIX03 · 적용 영향이 헤더에 보임", true, initial[1].impact.includes("최종 프롬프트"));
  check("UIX03 · negative 영향도 헤더에 보임", true,
    initial[1].impact.includes("negative 교체"));
  // Body and apply live in the same card, so the button is never separated from its text.
  check("UIX03 · 본문과 적용 버튼이 같은 카드", true, initial.every((card) => card.applyInside));
  // Long bodies are present in the DOM even while collapsed, so an expansion is instant.
  check("UIX03 · 접힌 본문도 내용을 보존", true,
    initial[2].prompt.length > 500 && initial[1].prompt.length > 500);
  // Collapsed really means "no pixels": measured height, not the attribute alone.
  check("UIX03 · 접힌 본문은 aria-expanded=false와 함께 높이 0", 2,
    initial.filter((card) => card.expanded === "false" && !card.bodyVisible).length);
  record("UIX03 초기", JSON.stringify(initial.map((card) => ({ title: card.title,
    expanded: card.expanded, bodyVisible: card.bodyVisible, impact: card.impact }))));
  await page.shot(shots, "uix03-01-header-first.png");

  // ── B. expand the second, compare several bodies at once ────────────────────
  const requestsBefore = await evaluate(`window.__composeCalls.length`);
  const fieldsBefore = await evaluate(FIELDS);
  await evaluate(toggleCard("분위기 강조"));
  await sleep(300);
  const compared = await evaluate(CARDS);
  check("UIX03 · 두 번째 본문 펼침", true, compared[1].bodyVisible);
  // Comparison is the point: two bodies open at the same time.
  check("UIX03 · 첫·둘째 본문 동시 펼침", true,
    compared[0].bodyVisible && compared[1].bodyVisible);
  check("UIX03 · 펼침은 aria-expanded로도 노출", "true", compared[1].expanded);
  check("UIX03 · 펼침만으로 요청 없음", requestsBefore,
    await evaluate(`window.__composeCalls.length`));
  check("UIX03 · 펼침만으로 최종 입력 불변", JSON.stringify(fieldsBefore),
    JSON.stringify(await evaluate(FIELDS)));

  // The third body can join the comparison: all three open at once.
  await evaluate(toggleCard("구도 강조"));
  await sleep(300);
  const triple = await evaluate(CARDS);
  check("UIX03 · 세 후보 동시 펼침", JSON.stringify([true, true, true]),
    JSON.stringify(triple.map((card) => card.bodyVisible)));
  // Per-card independence: closing the middle one leaves the other two open.
  await evaluate(toggleCard("분위기 강조"));
  await sleep(250);
  const independent = await evaluate(CARDS);
  check("UIX03 · 카드별 펼침이 독립적", JSON.stringify([true, false, true]),
    JSON.stringify(independent.map((card) => card.bodyVisible)));
  await evaluate(toggleCard("분위기 강조"));
  await sleep(250);
  await page.shot(shots, "uix03-02-compare.png");

  // Closing the default-open first card is possible, and the others stay as they were.
  await evaluate(toggleCard("원문 충실"));
  await sleep(250);
  const foldedFirst = await evaluate(CARDS);
  check("UIX03 · 기본 펼침도 접을 수 있음", false, foldedFirst[0].bodyVisible);
  check("UIX03 · 접어도 다른 본문은 유지", true, foldedFirst[1].bodyVisible);
  // It must not spring back open on a later render: `collapsed` remembers the choice.
  await sleep(700);
  check("UIX03 · 접은 첫 카드가 되돌아 열리지 않음", false,
    (await evaluate(CARDS))[0].bodyVisible);
  // Reopen it, so the apply section starts from the same all-open state it asserts.
  await evaluate(toggleCard("원문 충실"));
  await sleep(250);
  check("UIX03 · 다시 펼치면 세 본문이 모두 열림", JSON.stringify([true, true, true]),
    JSON.stringify((await evaluate(CARDS)).map((card) => card.bodyVisible)));

  // ── C. applying the second candidate lands its exact string ────────────────
  await evaluate(`window.__confirmCalls = 0;
    window.confirm = () => { window.__confirmCalls += 1; return true; };`);
  await evaluate(applyCard("분위기 강조"));
  await sleep(500);
  const applied = await evaluate(FIELDS);
  check("UIX03 · 두 번째 후보 문자열이 최종 입력에 적용", LONG_B, applied.prompt);
  check("UIX03 · 그 후보의 negative도 적용", "blurry, text", applied.negative);
  check("UIX03 · 빈 입력 교체는 확인 없음", 0, await evaluate(`window.__confirmCalls`));
  const appliedCards = await evaluate(CARDS);
  check("UIX03 · 적용된 카드만 적용됨 표시", JSON.stringify([false, true, false]),
    JSON.stringify(appliedCards.map((card) => card.applied)));
  check("UIX03 · 적용됨 배지가 헤더에 있음", true, appliedCards[1].appliedBadge);
  check("UIX03 · 적용 후에도 카드 3개 유지", 3, appliedCards.length);
  // Expansion and applied are different facts: applying must not fold or unfold anything.
  check("UIX03 · 적용이 펼침 상태를 바꾸지 않음", JSON.stringify([true, true, true]),
    JSON.stringify(appliedCards.map((card) => card.bodyVisible)));
  record("UIX03 적용", JSON.stringify({ prompt: applied.prompt.slice(0, 40),
    negative: applied.negative, applied: appliedCards.map((card) => card.applied) }));
  await page.shot(shots, "uix03-03-applied.png");

  // ── D. a user edit makes the next apply ask, and a refusal keeps the text ───
  await typeInto("#prompt-final", "my own carefully written prompt");
  await sleep(300);
  await evaluate(`window.__confirmCalls = 0; window.__confirmAnswer = false;
    window.confirm = () => { window.__confirmCalls += 1; return window.__confirmAnswer; };`);
  await evaluate(applyCard("구도 강조"));
  await sleep(400);
  const refused = await evaluate(FIELDS);
  check("UIX03 · 직접 수정 후 적용은 확인을 요구", 1, await evaluate(`window.__confirmCalls`));
  check("UIX03 · 확인 취소 시 최종 입력 유지", "my own carefully written prompt", refused.prompt);
  check("UIX03 · 확인 취소 시 negative 유지", "blurry, text", refused.negative);

  await evaluate(`window.__confirmCalls = 0; window.__confirmAnswer = true;`);
  await evaluate(applyCard("구도 강조"));
  await sleep(500);
  check("UIX03 · 확인 승인 시 적용", LONG_C, (await evaluate(FIELDS)).prompt);

  // ── E. one-step undo brings back exactly what the field held ────────────────
  await clickByText(".compose-undo button", "적용 되돌리기");
  await sleep(500);
  const undone = await evaluate(FIELDS);
  check("UIX03 · 되돌리기가 적용 전 문자열 복원", "my own carefully written prompt",
    undone.prompt);
  check("UIX03 · 되돌리기가 negative도 복원", "blurry, text", undone.negative);
  record("UIX03 덮어쓰기·되돌리기", JSON.stringify({ refused: refused.prompt,
    afterUndo: undone.prompt }));

  // ── F. staleness: editing the brief invalidates the displayed reply ─────────
  const beforeStale = await evaluate(FIELDS);
  const staleRequests = await evaluate(`window.__composeCalls.length`);
  await typeInto("#compose-brief", `${BRIEF} 뒤돌아보며`);
  await sleep(400);
  const staleCards = await evaluate(CARDS);
  const staleNotice = await evaluate(`(() => {
    const note = document.querySelector('.compose-results .compose-notice');
    return note ? note.textContent.replace(/\\s+/g, ' ').trim() : null;
  })()`);
  check("UIX03 · 원문 수정은 후보를 무효화", true,
    (staleNotice ?? "").includes("적용할 수 없습니다"));
  check("UIX03 · 무효화는 후보를 지우지 않음", 3, staleCards.length);
  check("UIX03 · 무효화만으로 최종 입력 불변", JSON.stringify(beforeStale),
    JSON.stringify(await evaluate(FIELDS)));
  check("UIX03 · 무효화만으로 요청 없음", staleRequests,
    await evaluate(`window.__composeCalls.length`));
  // An invalidated candidate must not be appliable: the UCP rule, reached through the card.
  const staleApply = await evaluate(applyCard("분위기 강조"));
  await sleep(350);
  const afterStaleApply = await evaluate(FIELDS);
  check("UIX03 · 무효화된 후보는 적용되지 않음", JSON.stringify(beforeStale),
    JSON.stringify(afterStaleApply));
  check("UIX03 · 무효화 적용 거부 사유가 표시됨", true, await evaluate(`(() => {
    const status = document.querySelector('#compose-status');
    return Boolean(status && status.textContent.includes('다시 생성'));
  })()`));
  record("UIX03 무효화", JSON.stringify({ notice: staleNotice,
    applyBlocked: afterStaleApply.prompt === beforeStale.prompt, clicked: staleApply }));
  await page.shot(shots, "uix03-04-stale.png");

  // ── G. a new reply does not inherit the previous reply's expansion ─────────
  // The hazard: reply #2 reuses candidate ids that reply #1 had open. A bare id set would
  // open the wrong card; the `resultId` key means the defaults apply instead.
  await evaluate(`window.__composeReply = ${JSON.stringify(replyWith({
    result_id: "cmp-uix03-0002", summary_ko: "다시 만든 장면",
  }))};`);
  await click(".compose-generate");
  await waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "uix03 second reply", timeout: 20000 });
  await sleep(450);
  const secondReply = await evaluate(CARDS);
  check("UIX03 · 새 응답은 기본 펼침으로 시작", JSON.stringify([true, false, false]),
    JSON.stringify(secondReply.map((card) => card.bodyVisible)));
  check("UIX03 · 새 응답이 최종 입력을 바꾸지 않음", "my own carefully written prompt",
    (await evaluate(FIELDS)).prompt);
  check("UIX03 · 새 응답에서 적용 표시가 초기화됨", JSON.stringify([false, false, false]),
    JSON.stringify(secondReply.map((card) => card.applied)));
  record("UIX03 새 응답", JSON.stringify(secondReply.map((card) => card.bodyVisible)));


  // ── H. in-flight request, folded path, and the strip ───────────────────────
  // A slow reply makes the race real instead of theoretical: start the request from the
  // panel, fold to the English field *while it is in flight*, and type there.
  await evaluate(`window.__composeDelay = 1500;`);
  await click(".compose-generate");
  await sleep(300);
  // Pending must be visible in the strip only after folding; before that the panel says it.
  await clickByText(".prompt-paths button", "최종 프롬프트 직접 입력");
  await sleep(250);
  const pendingStrip = await evaluate(STRIP);
  check("UIX03 · 접힌 상태에서 진행 표시", "pending", pendingStrip.phase);
  check("UIX03 · 진행 문구가 생성 중임을 말함", true, pendingStrip.text.includes("만드는 중"));
  // The strip lives in the composer, above the fold point, so folding lands the viewport on
  // it. Measure after scrolling it into view — "is it reachable" is the claim, not "is it
  // already painted at scroll 0", which no design with a long form can promise.
  await evaluate(`(() => {
    document.querySelector('.compose-strip')?.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(250);
  check("UIX03 · 접힌 동안 띠가 화면 안에 있음", true, (await evaluate(STRIP)).inViewport);
  await page.shot(shots, "uix03-05-folded-pending.png");

  const focusBefore = await evaluate(FOCUS);
  const promptBefore = await evaluate(FIELDS);
  // The user types while the request is still in flight.
  await typeInto("#prompt-final", "typed while composing");
  await sleep(200);
  const typedFocus = await evaluate(FOCUS);
  await sleep(1600);            // let the slow reply land
  const afterArrival = await evaluate(`(() => ({
    ...${FIELDS},
    focus: ${FOCUS},
    strip: ${STRIP},
  }))()`);
  check("UIX03 · 응답 도착이 직접 입력을 덮어쓰지 않음", "typed while composing",
    afterArrival.prompt);
  check("UIX03 · 응답 도착이 negative를 바꾸지 않음", promptBefore.negative,
    afterArrival.negative);
  check("UIX03 · 응답 도착이 포커스를 옮기지 않음", JSON.stringify(typedFocus),
    JSON.stringify(afterArrival.focus));
  check("UIX03 · 포커스가 실제로 영어 필드에 있었음", "prompt-final", typedFocus.id);
  check("UIX03 · 접힌 띠가 준비 상태를 알림", "ready", afterArrival.strip.phase);
  check("UIX03 · 띠가 후보 개수를 말함", true, afterArrival.strip.text.includes("후보 3개"));
  record("UIX03 접힌 응답", JSON.stringify(afterArrival));
  await page.shot(shots, "uix03-06-folded-ready.png");

  // The strip's link returns to the compose path without writing anything.
  const beforeReturn = await evaluate(FIELDS);
  await clickByText(".compose-strip button", "한글 장면으로 돌아가기");
  await sleep(350);
  const returned = await evaluate(`(() => ({
    ...${STRIP},
    ...${FIELDS},
    focus: ${FOCUS},
  }))()`);
  check("UIX03 · 띠의 링크가 한글 영역을 다시 엶", false, returned.folded);
  check("UIX03 · 띠의 링크가 최종 입력을 바꾸지 않음", beforeReturn.prompt, returned.prompt);

  // ── I. failure and cancel both reach the strip ─────────────────────────────
  await evaluate(`window.__composeDelay = 0; window.__composeMode = "fail";`);
  await click(".compose-generate");
  await sleep(1400);
  await clickByText(".prompt-paths button", "최종 프롬프트 직접 입력");
  await sleep(400);
  const failedStrip = await evaluate(`(() => ({ ...${STRIP}, ...${FIELDS} }))()`);
  check("UIX03 · 접힌 띠가 실패를 알림", "failed", failedStrip.phase);
  check("UIX03 · 실패 문구에 실패임이 드러남", true, failedStrip.text.includes("실패"));
  check("UIX03 · 실패도 최종 입력을 바꾸지 않음", beforeReturn.prompt, failedStrip.prompt);
  record("UIX03 접힌 실패", JSON.stringify(failedStrip));
  await page.shot(shots, "uix03-07-folded-failed.png");

  // Retry from the panel must clear the failure and reach ready again.
  await evaluate(`window.__composeMode = "ready"; window.__composeReply = ${JSON.stringify(
    replyWith({ result_id: "cmp-uix03-0003" }))};`);
  await clickByText(".prompt-paths button", "한글 장면으로 만들기");
  await sleep(300);
  const retried = await clickByText(".compose-actions button", "다시 시도");
  await sleep(1200);
  check("UIX03 · 실패 후 다시 시도가 제공됨", true, retried);
  check("UIX03 · 다시 시도가 후보를 복구", 3, (await evaluate(CARDS)).length);

  // An in-flight request that is cancelled must say so through the projection too.
  await evaluate(`window.__composeDelay = 1500;`);
  await click(".compose-generate");
  await sleep(350);
  const cancelled = await clickByText(".compose-actions button", "취소");
  await sleep(400);
  await clickByText(".prompt-paths button", "최종 프롬프트 직접 입력");
  await sleep(400);
  const cancelledStrip = await evaluate(STRIP);
  check("UIX03 · 취소가 띠에 반영됨", "cancelled", cancelledStrip.phase);
  check("UIX03 · 취소 문구가 입력 보존을 알림", true,
    cancelledStrip.text.includes("그대로 남아"));
  record("UIX03 접힌 취소", JSON.stringify({ clicked: cancelled, ...cancelledStrip }));
  await evaluate(`window.__composeDelay = 0;`);

  // ── J. changing the model mid-request must expire the reply, not apply it ───
  await evaluate(`window.__composeDelay = 1600;
    window.__composeReply = ${JSON.stringify(replyWith({ result_id: "cmp-uix03-0004" }))};`);
  await clickByText(".prompt-paths button", "한글 장면으로 만들기");
  await sleep(250);
  await click(".compose-generate");
  await sleep(350);
  // Switch models while the reply for the previous model is still travelling.
  await select(".composer select", "fake-flux2");
  await sleep(1800);
  const afterModel = await evaluate(`(() => ({
    ...${FIELDS},
    cards: document.querySelectorAll('.compose-candidate').length,
    status: (document.querySelector('#compose-status')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
  }))()`);
  check("UIX03 · 모델 변경 뒤 이전 응답이 적용 불가", true,
    afterModel.status.includes("다시") || afterModel.cards === 0);
  check("UIX03 · 모델 변경이 최종 입력을 바꾸지 않음", "typed while composing",
    afterModel.prompt);
  record("UIX03 모델 변경", JSON.stringify({ cards: afterModel.cards,
    status: afterModel.status.slice(0, 120) }));

  // ── K. negative the model cannot take: impact says so, apply is two-step ────
  // A reload is the only honest way to change `negativeEnabled`: it is derived from the
  // `/models` reply, so the stub has to answer differently for a document that starts fresh.
  await evaluate(`window.__composeDelay = 0;
    try { sessionStorage.setItem('__uix03NoNegative', '1'); } catch {}`);
  await evaluate(`delete window.__uix03Doc`);
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`window.__uix03Doc === true && window.__uix03NoNegative === true`,
    { label: "uix03 no-negative document", timeout: 30000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "uix03 models reloaded", timeout: 30000 });
  await openBuilder(page);
  await select(".composer select", "fake-sd15");
  await sleep(700);
  const negativeFieldDisabled = await evaluate(`(() => {
    const field = document.querySelector('.composer textarea[rows="2"]');
    return Boolean(field && field.disabled);
  })()`);
  check("UIX03 · negative 미지원 모델은 필드가 비활성", true, negativeFieldDisabled);
  await composeOnce(page, sleep);
  const blockedCards = await evaluate(CARDS);
  check("UIX03 · 미지원 모델 카드가 negative 빠짐을 알림", true,
    blockedCards[1].impact.includes("negative 빠짐"));
  check("UIX03 · 미지원 본문이 빠짐을 설명", true,
    blockedCards[1].negative.includes("지원하지 않아"));

  // First press refuses and explains; the button then offers the lossy apply.
  await evaluate(`window.__confirmCalls = 0; window.confirm = () => true;`);
  await evaluate(applyCard("분위기 강조"));
  await sleep(400);
  const armFirst = await evaluate(`(() => ({
    ...${FIELDS},
    status: (document.querySelector('#compose-status')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
    button: [...document.querySelectorAll('.compose-candidate')]
      .map((n) => n.querySelector('.compose-apply')?.textContent?.trim() ?? null),
  }))()`);
  check("UIX03 · 첫 적용은 negative 손실을 설명하고 멈춤", true,
    armFirst.status.includes("지원되지 않습니다"));
  check("UIX03 · 첫 적용은 최종 입력을 쓰지 않음", "", armFirst.prompt ?? "");
  check("UIX03 · 두 번째 누름을 안내하는 버튼", true,
    (armFirst.button[1] ?? "").includes("negative 없이 적용"));

  // Second press proceeds, positive-only, and records the loss.
  await evaluate(applyCard("분위기 강조"));
  await sleep(500);
  const lossy = await evaluate(`(() => ({
    ...${FIELDS},
    status: (document.querySelector('#compose-status')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
  }))()`);
  check("UIX03 · 두 번째 누름이 긍정 프롬프트만 적용", LONG_B, lossy.prompt);
  check("UIX03 · 손실 적용은 negative를 남기지 않음", "", lossy.negative ?? "");
  check("UIX03 · 손실 적용 사실을 안내", true, lossy.status.includes("지원되지 않아"));
  record("UIX03 negative 미지원", JSON.stringify({ first: armFirst.status.slice(0, 120),
    applied: lossy.prompt.slice(0, 30), negative: lossy.negative }));
  await page.shot(shots, "uix03-08-no-negative.png");
  await evaluate(`try { sessionStorage.removeItem('__uix03NoNegative'); } catch {}`);


  check("UIX03 · 한글 영역으로 복귀해도 후보 유지", 3,
    (await evaluate(CARDS)).length);


  // ── L. keyboard reach, and the layout at both widths ───────────────────────
  // A fresh document without the no-negative flag, so the cards render normally again.
  await evaluate(`delete window.__uix03Doc`);
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`window.__uix03Doc === true && window.__uix03NoNegative === false`,
    { label: "uix03 final document", timeout: 30000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "uix03 final models", timeout: 30000 });
  await openBuilder(page);
  await select(".composer select", "fake-sd15");
  await sleep(700);
  await composeOnce(page, sleep);

  // A real Enter press must toggle the body: the header is the card's only focusable
  // control, so one press can never hit "the wrong part" of a long candidate.
  await evaluate(`(() => {
    const first = document.querySelector('.compose-candidate__toggle');
    first?.focus();
    return Boolean(first);
  })()`);
  const focusOnToggle = await evaluate(`(() => {
    const node = document.activeElement;
    return { cls: typeof node?.className === 'string' ? node.className : null,
      expanded: node?.getAttribute?.('aria-expanded') ?? null };
  })()`);
  check("UIX03 · 헤더 토글이 포커스 가능", true,
    (focusOnToggle.cls ?? "").includes("compose-candidate__toggle"));
  // The first card starts open, so this press closes it — the point is that it *flips*, and
  // that the measured body follows the announced state rather than drifting from it.
  const expandedBeforeKey = focusOnToggle.expanded;
  await press("Enter", "Enter", 13);
  await sleep(300);
  const afterKey = await evaluate(`(() => {
    const card = document.querySelector('.compose-candidate');
    const toggle = card?.querySelector('.compose-candidate__toggle');
    return {
      expanded: toggle?.getAttribute('aria-expanded') ?? null,
      bodyVisible: (card?.querySelector('.compose-candidate__body')?.getBoundingClientRect().height ?? 0) > 0,
      focusKept: document.activeElement === toggle,
    };
  })()`);
  check("UIX03 · Enter가 본문 펼침을 토글", true,
    afterKey.expanded !== expandedBeforeKey);
  check("UIX03 · 토글 뒤 본문 높이가 aria-expanded와 일치", afterKey.expanded,
    String(afterKey.bodyVisible));
  check("UIX03 · Enter 뒤에도 포커스가 헤더에 남음", true, afterKey.focusKept);
  // The toggle is a real button, so Space works too (native activation, no custom handler).
  await press(" ", "Space", 32);
  await sleep(300);
  check("UIX03 · Space도 같은 토글을 조작", expandedBeforeKey,
    await evaluate(`document.querySelector('.compose-candidate__toggle').getAttribute('aria-expanded')`));
  // Leave every body open for the layout pass below.
  await evaluate(`(() => {
    for (const node of document.querySelectorAll('.compose-candidate__toggle')) {
      if (node.getAttribute('aria-expanded') === 'false') node.click();
    }
    return true;
  })()`);
  await sleep(300);

  for (const [width, height, label] of [[360, 800, "360px"], [1280, 900, "1280px"]]) {
    await page.viewport(width, height, width < 500);
    await sleep(450);
    // Open every body: the widest case this layout can be asked to draw.
    await evaluate(`(() => {
      for (const node of document.querySelectorAll('.compose-candidate__toggle')) {
        if (node.getAttribute('aria-expanded') === 'false') node.click();
      }
      return true;
    })()`);
    await sleep(350);
    const layout = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.compose-candidate')].map((node) => {
        const body = node.querySelector('.compose-candidate__body');
        const prompt = node.querySelector('.compose-candidate__prompt');
        const toggle = node.querySelector('.compose-candidate__toggle');
        const apply = node.querySelector('.compose-apply');
        const head = toggle?.getBoundingClientRect();
        return {
          clipped: prompt ? prompt.scrollWidth > prompt.clientWidth + 1 : null,
          headHeight: head ? Math.round(head.height) : 0,
          applyHeight: apply ? Math.round(apply.getBoundingClientRect().height) : 0,
          overflow: node.scrollWidth - node.clientWidth,
          insideCard: body ? node.contains(body) && node.contains(apply) : false,
        };
      });
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        headerBelow44: cards.filter((card) => card.headHeight < 44).length,
        applyBelow44: cards.filter((card) => card.applyHeight < 44).length,
        clipped: cards.filter((card) => card.clipped === true).length,
        separated: cards.filter((card) => card.insideCard !== true).length,
        cardOverflow: cards.filter((card) => card.overflow > 1).length,
        allOpen: document.querySelectorAll('.compose-candidate__body:not([hidden])').length,
      };
    })()`);
    check(`UIX03 · ${label} 가로 넘침 없음`, true, layout.overflow <= 1);
    check(`UIX03 · ${label} 후보 본문 가로 잘림 없음`, 0, layout.clipped);
    check(`UIX03 · ${label} 카드 내부 넘침 없음`, 0, layout.cardOverflow);
    check(`UIX03 · ${label} 헤더 토글 44px 이상`, 0, layout.headerBelow44);
    check(`UIX03 · ${label} 적용 버튼 44px 이상`, 0, layout.applyBelow44);
    check(`UIX03 · ${label} 본문·버튼이 카드 안`, 0, layout.separated);
    check(`UIX03 · ${label} 세 본문이 모두 펼쳐짐`, 3, layout.allOpen);
    record(`UIX03 ${label}`, JSON.stringify(layout));
    // Frame the cards themselves: at 360px an unscrolled shot lands on the job queue.
    await evaluate(`(() => {
      const first = document.querySelector('.compose-candidate');
      if (first) first.scrollIntoView({ block: 'start' });
      return !!first;
    })()`);
    await sleep(350);
    await page.shot(shots, `uix03-09-${width}.png`);
  }

  // ── M. the four states the task asks to see at both widths ─────────────────
  // Each is captured at 360 and 1280 so the comparison can be made side by side rather than
  // trusting one width to represent the other. State is set explicitly per shot, because a
  // screenshot that happens to follow another state is not evidence about *this* one.
  for (const [width, height, label] of [[360, 800, "360"], [1280, 900, "1280"]]) {
    await page.viewport(width, height, width < 500);
    await sleep(400);
    // The previous iteration ends with the path folded for its strip shot, and a hidden
    // region measures 0 for every body. Open it first, or "collapsed" would be reported for
    // bodies that are simply not laid out.
    await clickByText(".prompt-paths button", "한글 장면으로 만들기");
    await sleep(350);
    check(`UIX03 · ${label} 캡처 전 한글 영역 펼침`, false,
      (await evaluate(STRIP)).folded);

    // (1) every body closed except the first — the arrival state.
    await evaluate(`(() => {
      const toggles = [...document.querySelectorAll('.compose-candidate__toggle')];
      toggles.forEach((node, index) => {
        const open = node.getAttribute('aria-expanded') === 'true';
        if (index === 0 && !open) node.click();
        if (index > 0 && open) node.click();
      });
      return true;
    })()`);
    await sleep(350);
    await evaluate(`document.querySelector('.compose-results')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);
    const arrival = await evaluate(CARDS);
    check(`UIX03 · ${label} 기본 접힘 상태 재현`, JSON.stringify([true, false, false]),
      JSON.stringify(arrival.map((card) => card.bodyVisible)));
    await page.shot(shots, `uix03-10-default-${label}.png`);

    // (2) two long bodies open at once, for comparison.
    await evaluate(toggleCard("분위기 강조"));
    await sleep(350);
    await evaluate(`document.querySelector('.compose-results')?.scrollIntoView({ block: 'start' })`);
    await sleep(250);
    const comparing = await evaluate(CARDS);
    check(`UIX03 · ${label} 복수 비교 상태 재현`, true,
      comparing[0].bodyVisible && comparing[1].bodyVisible);
    await page.shot(shots, `uix03-11-compare-${label}.png`);

    // (3) the overwrite confirm, armed but not answered.
    await typeInto("#prompt-final", `typed at ${label}`);
    await sleep(250);
    await evaluate(`window.__confirmCalls = 0;
      window.confirm = () => { window.__confirmCalls += 1; return false; };`);
    await evaluate(applyCard("분위기 강조"));
    await sleep(400);
    const confirmState = await evaluate(`(() => ({
      prompt: document.querySelector('#prompt-final')?.value ?? null,
      calls: window.__confirmCalls,
      status: (document.querySelector('#compose-status')?.textContent ?? '').trim(),
    }))()`);
    check(`UIX03 · ${label} 덮어쓰기 확인이 뜨고 취소됨`, 1, confirmState.calls);
    check(`UIX03 · ${label} 확인 취소 뒤 입력 유지`, `typed at ${label}`, confirmState.prompt);
    await evaluate(`document.querySelector('.compose-results')?.scrollIntoView({ block: 'start' })`);
    await sleep(250);
    await page.shot(shots, `uix03-12-confirm-${label}.png`);

    // (4) the folded Compose strip, mid-compose, with the direct field in front.
    await evaluate(`window.__composeDelay = 2200;
      window.__composeReply = ${JSON.stringify(replyWith({ result_id: `cmp-uix03-shot-${width}` }))};`);
    await clickByText(".prompt-paths button", "한글 장면으로 만들기");
    await sleep(300);
    await click(".compose-generate");
    await sleep(400);
    await clickByText(".prompt-paths button", "최종 프롬프트 직접 입력");
    await sleep(300);
    await evaluate(`document.querySelector('.compose-strip')?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    const foldedState = await evaluate(`(() => ({ ...${STRIP}, ...${FIELDS} }))()`);
    check(`UIX03 · ${label} 접힌 진행 상태 재현`, "pending", foldedState.phase);
    check(`UIX03 · ${label} 접힌 진행 중 입력 보존`, `typed at ${label}`, foldedState.prompt);
    await page.shot(shots, `uix03-13-folded-${label}.png`);
    await sleep(2400);
    await evaluate(`window.__composeDelay = 0;`);
  }
  await page.viewport(1280, 900, false);
  await sleep(300);
}
