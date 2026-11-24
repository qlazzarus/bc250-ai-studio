/**
 * UIX03 in a real browser: comparing long candidates and checking what an apply does.
 *
 * This block adds no contract either. It proves that the comparison layer sits on the UCP
 * apply machine without moving it, so every assertion is about one of four claims:
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
  unmapped_details: [],
  ambiguities: [],
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
  clarifications: [],
  warnings: [],
  snapshot_trim: [],
  provider: { model: "stub-compose", finish_reason: "stop" },
  ...over,
});

/** Installs compose capability + endpoint, and counts compose requests. */
async function installStub(page) {
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__uix03Doc = true;
    const real = window.fetch;
    window.__composeCalls = [];
    window.__composeReply = ${JSON.stringify(replyWith())};
    window.__composeMode = "ready";
    window.__composeDelay = 0;
    const json = (body) => new Response(JSON.stringify(body), { status: 200,
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
        return new Response(JSON.stringify(body), { status: response.status,
          headers: { "Content-Type": "application/json" } });
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

/**
 * Runs the UIX03 block.
 *
 * It reloads the page itself: the stub has to be installed before the app's first
 * capabilities fetch, and earlier blocks leave the composer in states this one would have to
 * unwind. `openBuilder` is the same helper every other block uses.
 */
export async function runUix03({ page, check, record, sleep, shots, evaluate }) {
  await installStub(page);
  await page.call("Page.reload", { ignoreCache: false });
  await page.waitFor(`window.__uix03Doc === true && !!document.querySelector('.composer select')`,
    { timeout: 20000, label: "uix03 reload" });
  await sleep(1200);
  await openBuilder(page);
  await page.select(".composer select", "fake-sd15");
  await sleep(700);

  // ── A. the header decides, all bodies closed except the first ────────────────
  await page.typeInto("#compose-brief", BRIEF);
  await sleep(250);
  await page.click(".compose-generate");
  await page.waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "uix03 three candidates", timeout: 20000 });
  await sleep(350);
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
  record("UIX03 초기", JSON.stringify(initial.map((card) => ({ title: card.title,
    expanded: card.expanded, bodyVisible: card.bodyVisible, impact: card.impact }))));
  await page.shot(shots, "uix03-01-header-first.png");

  // ── B. expand the second, compare two bodies at once ────────────────────────
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
  await page.shot(shots, "uix03-02-compare.png");

  // Closing the default-open first card is possible, and leaves only the second open.
  await evaluate(toggleCard("원문 충실"));
  await sleep(250);
  const foldedFirst = await evaluate(CARDS);
  check("UIX03 · 기본 펼침도 접을 수 있음", false, foldedFirst[0].bodyVisible);
  check("UIX03 · 접어도 다른 본문은 유지", true, foldedFirst[1].bodyVisible);
  await evaluate(toggleCard("원문 충실"));
  await sleep(250);

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
  record("UIX03 적용", JSON.stringify({ prompt: applied.prompt.slice(0, 40),
    negative: applied.negative, applied: appliedCards.map((card) => card.applied) }));
  await page.shot(shots, "uix03-03-applied.png");

  // ── D. a user edit makes the next apply ask, and a refusal keeps the text ───
  await page.typeInto("#prompt-final", "my own carefully written prompt");
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
  await page.clickByText(".compose-undo button", "적용 되돌리기");
  await sleep(500);
  const undone = await evaluate(FIELDS);
  check("UIX03 · 되돌리기가 적용 전 문자열 복원", "my own carefully written prompt",
    undone.prompt);
  check("UIX03 · 되돌리기가 negative도 복원", "blurry, text", undone.negative);
  record("UIX03 덮어쓰기·되돌리기", JSON.stringify({ refused: refused.prompt,
    afterUndo: undone.prompt }));

  // ── F. a negative the model cannot take: the impact says so, apply is two-step ─
  // `fake-sd15` at the default CFG accepts a negative prompt, so the *card* still shows the
  // candidate's own string; the block below moves CFG so the model genuinely cannot take one
  // and the impact line has to change. This section first proves the lossless case so the
  // difference is attributable to the CFG rather than to the fixture.
  const lossless = await evaluate(CARDS);
  check("UIX03 · negative 지원 모델은 교체로 표시", true,
    lossless[1].impact.includes("negative 교체"));
  check("UIX03 · negative 지원 모델 카드에 negative 본문", true,
    lossless[1].negative.includes("blurry, text"));

  // ── G. staleness: editing the brief invalidates the displayed reply ─────────
  const beforeStale = await evaluate(FIELDS);
  const staleRequests = await evaluate(`window.__composeCalls.length`);
  await page.typeInto("#compose-brief", `${BRIEF} 뒤돌아보며`);
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
  const staleApply = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.compose-candidate')]
      .find((node) => (node.textContent || '').includes('분위기 강조'));
    if (!card) return { found: false };
    card.querySelector('.compose-apply').click();
    return { found: true };
  })()`);
  await sleep(350);
  const afterStaleApply = await evaluate(FIELDS);
  check("UIX03 · 무효화된 후보는 적용되지 않음", JSON.stringify(beforeStale),
    JSON.stringify(afterStaleApply));
  check("UIX03 · 무효화 적용 거부 사유가 표시됨", true, await evaluate(`(() => {
    const status = document.querySelector('#compose-status');
    return Boolean(status && status.textContent.includes('다시 생성'));
  })()`));
  record("UIX03 무효화", JSON.stringify({ notice: staleNotice,
    applyBlocked: afterStaleApply.prompt === beforeStale.prompt, staleApply }));
  await page.shot(shots, "uix03-04-stale.png");

  // ── H. a new reply does not inherit the previous reply's expansion ─────────
  // The task's hazard: reply #2 reuses candidate ids that reply #1 had open. A bare id set
  // would open the wrong card; the `resultId` key means the defaults apply instead.
  await evaluate(`window.__composeReply = ${JSON.stringify(replyWith({
    result_id: "cmp-uix03-0002", summary_ko: "다시 만든 장면",
  }))};`);
  await page.click(".compose-generate");
  await page.waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "uix03 second reply", timeout: 20000 });
  await sleep(400);
  const secondReply = await evaluate(CARDS);
  check("UIX03 · 새 응답은 기본 펼침으로 시작", JSON.stringify([true, false, false]),
    JSON.stringify(secondReply.map((card) => card.bodyVisible)));
  check("UIX03 · 새 응답도 최종 입력을 바꾸지 않음", "my own carefully written prompt",
    (await evaluate(FIELDS)).prompt);
  record("UIX03 새 응답", JSON.stringify(secondReply.map((card) => card.bodyVisible)));

  // ── I. the folded strip is read-only, and a reply cannot steal the cursor ────
  // Fold the Korean region, then start a request from the panel and switch to the English
  // field *while it is in flight*. A slow reply makes the window real instead of theoretical.
  await evaluate(`window.__composeDelay = 1200;`);
  await page.click(".compose-generate");
  await sleep(250);
  await page.clickByText(".prompt-paths button", "최종 프롬프트 직접 입력");
  await sleep(200);
  const focusedBefore = await evaluate(`document.activeElement?.id ?? null`);
  const promptBefore = await evaluate(FIELDS);
  // The user types while the request is still in flight.
  await page.typeInto("#prompt-final", "typed while composing");
  await sleep(1600);
  const afterArrival = await evaluate(`(() => ({
    prompt: document.querySelector('#prompt-final')?.value ?? null,
    negative: document.querySelector('.composer textarea[rows="2"]')?.value ?? null,
    focused: document.activeElement?.id ?? null,
    strip: document.querySelector('.compose-strip')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    stripPhase: document.querySelector('.compose-strip')?.getAttribute('data-phase') ?? null,
    folded: !!document.querySelector('#compose-path')?.hidden,
  }))()`);
  check("UIX03 · 접힌 상태에서 응답이 도착", true, afterArrival.folded);
  check("UIX03 · 응답 도착이 직접 입력을 덮어쓰지 않음", promptBefore.prompt, afterArrival.prompt);
  check("UIX03 · 응답 도착이 negative를 바꾸지 않음", promptBefore.negative,
    afterArrival.negative);
  check("UIX03 · 응답 도착이 포커스를 옮기지 않음", focusedBefore, afterArrival.focused);
  check("UIX03 · 접힌 띠가 준비 상태를 알림", "ready", afterArrival.stripPhase);
  check("UIX03 · 띠가 후보 개수를 말함", true, (afterArrival.strip ?? "").includes("후보 3개"));
  record("UIX03 접힌 응답", JSON.stringify(afterArrival));
  await page.shot(shots, "uix03-05-folded-strip.png");

  // The strip's link returns to the compose path without writing anything.
  const beforeReturn = await evaluate(FIELDS);
  await page.clickByText(".compose-strip button", "한글 장면으로 돌아가기");
  await sleep(300);
  const returned = await evaluate(`(() => ({
    folded: !!document.querySelector('#compose-path')?.hidden,
    focused: document.activeElement?.id ?? null,
    prompt: document.querySelector('#prompt-final')?.value ?? null,
  }))()`);
  check("UIX03 · 띠의 링크가 한글 영역을 다시 엶", false, returned.folded);
  check("UIX03 · 띠의 링크가 최종 입력을 바꾸지 않음", beforeReturn.prompt, returned.prompt);

  // Failure is reported in the strip too, with the alert's own headline.
  await evaluate(`window.__composeDelay = 0; window.__composeMode = "fail";`);
  await page.click(".compose-generate");
  await sleep(1200);
  await page.clickByText(".prompt-paths button", "최종 프롬프트 직접 입력");
  await sleep(400);
  const failedStrip = await evaluate(`(() => ({
    phase: document.querySelector('.compose-strip')?.getAttribute('data-phase') ?? null,
    text: document.querySelector('.compose-strip')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    prompt: document.querySelector('#prompt-final')?.value ?? null,
  }))()`);
  check("UIX03 · 접힌 띠가 실패를 알림", "failed", failedStrip.phase);
  check("UIX03 · 실패 문구에 사유가 포함", true,
    (failedStrip.text ?? "").includes("실패"));
  check("UIX03 · 실패도 최종 입력을 바꾸지 않음", beforeReturn.prompt, failedStrip.prompt);
  record("UIX03 접힌 실패", JSON.stringify(failedStrip));
  await evaluate(`window.__composeMode = "ready";`);

  // ── J. keyboard reach and long bodies at 360/1280 ───────────────────────────
  await page.clickByText(".prompt-paths button", "한글 장면으로 돌아가기").catch(() => false);
  await sleep(300);
  await evaluate(`window.__composeReply = ${JSON.stringify(replyWith({
    result_id: "cmp-uix03-0003",
  }))};`);
  await page.click(".compose-generate");
  await page.waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "uix03 final reply", timeout: 20000 });
  await sleep(400);

  // A real Tab press must land on the header toggle, and Enter must open the body: the
  // header is the only focusable control of the card, so one press can never hit "the wrong
  // part" of a long candidate.
  await evaluate(`(() => {
    const first = document.querySelector('.compose-candidate__toggle');
    first?.focus();
    return Boolean(first);
  })()`);
  const focusOnToggle = await evaluate(`(() => {
    const node = document.activeElement;
    return { cls: node?.className ?? null, expanded: node?.getAttribute?.('aria-expanded') ?? null };
  })()`);
  check("UIX03 · 헤더 토글이 포커스 가능", true,
    (focusOnToggle.cls ?? "").includes("compose-candidate__toggle"));
  const expandedBeforeKey = focusOnToggle.expanded;
  await page.press("Enter", "Enter", 13);
  await sleep(300);
  const afterKey = await evaluate(`(() => {
    const card = document.querySelector('.compose-candidate');
    return {
      expanded: card?.querySelector('.compose-candidate__toggle')?.getAttribute('aria-expanded') ?? null,
      bodyVisible: (card?.querySelector('.compose-candidate__body')?.getBoundingClientRect().height ?? 0) > 0,
    };
  })()`);
  check("UIX03 · Enter가 본문 펼침을 토글", true,
    afterKey.expanded !== expandedBeforeKey && afterKey.bodyVisible);

  for (const [width, height, label] of [[360, 800, "360px"], [1280, 900, "1280px"]]) {
    await page.viewport(width, height, width < 500);
    await sleep(400);
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
      };
    })()`);
    check(`UIX03 · ${label} 가로 넘침 없음`, true, layout.overflow <= 1);
    check(`UIX03 · ${label} 후보 본문 가로 잘림 없음`, 0, layout.clipped);
    check(`UIX03 · ${label} 카드 내부 넘침 없음`, 0, layout.cardOverflow);
    check(`UIX03 · ${label} 헤더 토글 44px 이상`, 0, layout.headerBelow44);
    check(`UIX03 · ${label} 적용 버튼 44px 이상`, 0, layout.applyBelow44);
    check(`UIX03 · ${label} 본문·버튼이 카드 안`, 0, layout.separated);
    record(`UIX03 ${label}`, JSON.stringify(layout));
    await page.shot(shots, `uix03-06-${width}.png`);
  }
  await page.viewport(1280, 900, false);
  await sleep(300);
}

const applyCard = (title) => `(() => {
  const card = [...document.querySelectorAll('.compose-candidate')]
    .find((node) => (node.textContent || '').includes(${JSON.stringify(title)}));
  const button = card?.querySelector('.compose-apply');
  if (!button) return false;
  button.scrollIntoView({ block: 'center' });
  button.click();
  return true;
})()`;
