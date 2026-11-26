/**
 * UIX02 in a real browser: reading and fixing many dictionary selections.
 *
 * This block adds no new contract. It is here to prove that the *display* layer this task
 * built — the always-visible counts bar, the attribution grouping, and the per-chip control
 * group — sits on top of the existing UCP state machine without moving it. So every
 * assertion is about one of three things:
 *
 * 1. **The numbers match the chips.** After a real sequence of attribution/pin/remove/restore
 *    presses, the bar's counts must equal what the chip cards say, and the targeted chip must
 *    have the ID, attribution and pin the press asked for.
 * 2. **View state is not request state.** Searching, folding, and opening detail must not
 *    bump a revision, must not send `/prompt/compose`, and must not change the request body.
 *    Where a sequence *should* send (a real selection change), the request is inspected.
 * 3. **Selection survives the view.** A search that matches nothing, a fold and refold, and
 *    a reopen all leave the selection exactly as it was.
 *
 * The compose reply is stubbed exactly as UCP08 does (the fake engine does not advertise
 * compose). Nothing here is translation-quality evidence.
 */
import { openBuilder } from "./ui.mjs";

const FREE_TEXT = "비 오는 골목에 서 있는 여성과 파란 코트를 입은 남성";

/** Two people plus a neon lamp, so attribution, pin and exclusion all have a subject. */
const SCENE = {
  entities: [
    { entity_id: "entity-1", kind: "person", count: 1,
      attributes_ko: ["검은 머리"], evidence_ko: "여성" },
    { entity_id: "entity-2", kind: "person", count: 1,
      attributes_ko: ["파란 코트"], evidence_ko: "남성" },
  ],
  relations: [{ subject_entity_id: "entity-1", predicate_ko: "기다린다",
    object_entity_id: "entity-2", evidence_ko: "기다리는" }],
  environment: { location_ko: "비 오는 골목", time_ko: "밤", lighting_ko: "네온" },
  unmapped_details: [],
  ambiguities: [],
};

/**
 * Four chips spread over both people and the whole scene.
 *
 * No `excluded` row here on purpose: `mergeSelections` drops a veto that the *server*
 * sent, because a veto is the user's decision and a reply re-deriving one must not revive
 * it. So this block creates its vetoes the way a user does — by removing a chip — instead
 * of pretending a reply could hand one over.
 */
const REPLY = {
  result_id: "cmp-uix02-0001",
  status: "ready",
  summary_ko: "비 오는 골목에 선 여성과 기다리는 남성",
  scene: SCENE,
  selections: [
    { id: "subject.person", source: "auto", pinned: false, entity_id: "entity-1" },
    { id: "action.standing", source: "auto", pinned: false, entity_id: "entity-1" },
    { id: "lighting.neon", source: "auto", pinned: false, entity_id: "entity-2" },
    { id: "location.street", source: "auto", pinned: false },
  ],
  candidates: [
    { candidate_id: "cand-a", title_ko: "원문 충실", difference_ko: "원문 그대로",
      positive_prompt: "a woman and a man in a rainy alley, neon", negative_prompt: null,
      preserved_ko: [] },
  ],
  clarifications: [],
  warnings: [],
  snapshot_trim: [],
  provider: { model: "stub-compose", finish_reason: "stop" },
};

/** Installs compose capability + endpoint and counts every compose request. */
async function installStub(page) {
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    // Marks the new document, so the reload below can wait for *this* document instead of
    // matching the pre-reload DOM, which still answers the "models loaded" query.
    window.__uix02Doc = true;
    const real = window.fetch;
    window.__composeCalls = [];
    window.__composeReply = ${JSON.stringify(REPLY)};
    window.__composeMode = "ready";
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

/** Sets a React-controlled value the way a keystroke would. */
const setValue = (selector, value) => `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return null;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')
    .set.call(node, ${JSON.stringify(value)});
  node.dispatchEvent(new Event('input', { bubbles: true }));
  return node.value;
})()`;

/**
 * Everything the bar claims plus the chip cards it claims it about.
 *
 * `counts` is read from the bar's own text, so a bar that renders a stale number fails
 * even if the chip cards are right — the two must agree, not merely both exist.
 */
const VIEW = `(() => {
  const text = (node) => (node?.textContent ?? "").replace(/\\s+/g, " ").trim();
  const count = (kind) => {
    const node = document.querySelector('.compose-count[data-kind="' + kind + '"]');
    if (!node) return null;
    const strong = node.querySelector('strong');
    return strong ? Number(strong.textContent) : null;
  };
  const chips = [...document.querySelectorAll('.compose-chip')].map((node) => ({
    label: text(node.querySelector('.compose-chip__label')),
    source: node.getAttribute('data-source'),
    pinned: node.hasAttribute('data-pinned'),
    badges: [...node.querySelectorAll('.compose-chip__badge')].map(text),
    entity: text(node.querySelector('.compose-chip__entity')) || null,
    entityId: node.querySelector('select') ? node.querySelector('select').value : null,
    group: node.closest('.compose-chip-group')?.getAttribute('data-group') ?? null,
  }));
  const groups = [...document.querySelectorAll('.compose-chip-group')].map((node) => ({
    key: node.getAttribute('data-group'),
    heading: text(node.querySelector('.compose-chip-group__heading')),
    chips: [...node.querySelectorAll('.compose-chip')].map(
      (chip) => text(chip.querySelector('.compose-chip__label'))),
  }));
  return {
    counts: { chosen: count('chosen'), pinned: count('pinned'),
      excluded: count('excluded'), clashes: count('clashes') },
    bar: text(document.querySelector('.compose-counts')),
    chips,
    groups,
    excluded: [...document.querySelectorAll('.compose-excluded li')].map((node) => ({
      id: node.getAttribute('data-chip-id'),
      label: text(node.querySelector('.compose-chip__label')),
      badges: [...node.querySelectorAll('.compose-chip__badge')].map(text),
    })),
    clashRows: [...document.querySelectorAll('.compose-clashes li')].map((node) => ({
      id: node.getAttribute('data-chip-id'),
      label: text(node.querySelector('.compose-clashes__label')),
      phrase: text(node.querySelector('.compose-clashes__phrase')),
      buttons: [...node.querySelectorAll('button')].map((button) => button.textContent.trim()),
      buttonsInside: !!node.querySelector('.compose-clashes__actions'),
    })),
    searchCount: text(document.querySelector('.compose-search-count')),
    dictionaryOpen: !!document.querySelector('#compose-dictionary'),
    summary: text(document.querySelector('.compose-summary')),
    brief: document.querySelector('#compose-brief')?.value ?? null,
    finalPrompt: document.querySelector('.composer textarea[rows="5"]')?.value ?? null,
    requests: window.__composeCalls.length,
    lastSelections: (() => {
      const last = window.__composeCalls[window.__composeCalls.length - 1];
      return last ? last.selections : null;
    })(),
  };
})()`;

/** Clicks a chip's control by its aria-label suffix, and reports what it clicked. */
const chipPress = (labelMatch, suffix) => `(() => {
  const chip = [...document.querySelectorAll('.compose-chip')]
    .find((node) => (node.querySelector('.compose-chip__label')?.textContent ?? "").includes(${JSON.stringify(labelMatch)}));
  if (!chip) return { clicked: false, why: 'chip' };
  const button = [...chip.querySelectorAll('.compose-chip__actions button')]
    .find((node) => (node.getAttribute('aria-label') || '').endsWith(${JSON.stringify(suffix)}));
  if (!button) return { clicked: false, why: 'button' };
  const aria = button.getAttribute('aria-label');
  button.click();
  return { clicked: true, aria };
})()`;

/** Chooses an attribution for one chip through the native select. */
const attribute = (labelMatch, entityId) => `(() => {
  const chip = [...document.querySelectorAll('.compose-chip')]
    .find((node) => (node.querySelector('.compose-chip__label')?.textContent ?? "").includes(${JSON.stringify(labelMatch)}));
  const select = chip && chip.querySelector('select');
  if (!select) return { changed: false };
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value')
    .set.call(select, ${JSON.stringify(entityId)});
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return { changed: true, now: select.value };
})()`;

export async function runUix02({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select } = page;

  await installStub(page);
  // A full reload so this block owns its document: UCP08 leaves a saved v3 record, a modal
  // and its own capability stub behind, and inheriting any of that would make the counts
  // below start from a state this block never asserted on. The stub above is registered for
  // new documents, so it survives the reload and is outermost.
  //
  // The clear-then-wait order matters: `waitFor` would otherwise match the pre-reload DOM
  // (which still has models and a builder) and return before navigation even started.
  await evaluate(`delete window.__uix02Doc`);
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`window.__uix02Doc === true`, { label: "uix02 new document", timeout: 30000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "uix02 models", timeout: 30000 });
  await openBuilder(page);
  await select(".composer select", "fake-sd15");
  await sleep(400);
  await clickByText(".prompt-paths button", "한글 장면으로 만들기");
  await sleep(300);
  await typeInto("#compose-brief", FREE_TEXT);
  await click(".compose-generate");
  await waitFor(`!!document.querySelector('.compose-chip')`, { label: "uix02 chips", timeout: 20000 });
  await sleep(300);

  // ── A. the counts bar exists before anything is folded or sent ────────────────
  const start = await evaluate(VIEW);
  check("UIX02 · 선택 요약이 칩과 함께 표시", true, start.counts.chosen === 4);
  check("UIX02 · 요약 문구에 네 숫자", true,
    ["선택", "고정", "제외", "미해결 충돌"].every((word) => start.bar.includes(word)));
  record("UIX02 시작", JSON.stringify({ counts: start.counts, groups: start.groups.map((g) => g.heading) }));

  // ── B. multi-person grouping is visible and display-only ─────────────────────
  check("UIX02 · 다인 장면은 귀속별 그룹", true, start.groups.length >= 2);
  check("UIX02 · 그룹 제목이 인물/장면 전체를 구분", true,
    start.groups.some((group) => group.heading.includes("인물"))
    && start.groups.some((group) => group.heading.includes("장면 전체")));
  // Flattening the groups must reproduce the chip order, which is `edit.selections` order.
  check("UIX02 · 그룹화가 선택 순서를 바꾸지 않음", true,
    JSON.stringify(start.chips.map((chip) => chip.label))
    === JSON.stringify(start.groups.flatMap((group) => group.chips)));

  // ── C. attribution → pin → remove another → restore a veto, in one sequence ──
  // The task's completion criterion, executed as four real presses on one target chip.
  const target = "조명";
  const beforeAttribution = start.chips.find((chip) => chip.label.includes(target));
  check("UIX02 · 대상 칩은 처음에 다른 인물", true, beforeAttribution?.entityId === "entity-2");

  await evaluate(`(() => {
    const chip = [...document.querySelectorAll('.compose-chip')]
      .find((node) => node.querySelector('.compose-chip__label')?.textContent.includes(${JSON.stringify(target)}));
    chip?.querySelector('select')?.focus();
  })()`);
  await evaluate(attribute(target, "entity-1"));
  await sleep(300);
  const afterAttribution = await evaluate(VIEW);
  const movedChip = afterAttribution.chips.find((chip) => chip.label.includes(target));
  check("UIX07 · 귀속 변경 후 해당 선택에 포커스 유지", true, await evaluate(`(() => {
    const active = document.activeElement;
    return active?.tagName === 'SELECT' &&
      active.closest('.compose-chip')?.querySelector('.compose-chip__label')?.textContent.includes(${JSON.stringify(target)});
  })()`));
  check("UIX02 · 귀속 변경이 대상 칩에만 적용", "entity-1", movedChip?.entityId);
  check("UIX02 · 귀속 변경 후 그룹이 이동", "entity-1", movedChip?.group);
  check("UIX02 · 귀속 변경이 개수를 바꾸지 않음",
    JSON.stringify(start.counts), JSON.stringify(afterAttribution.counts));
  // Attribution is local edit state: it is sent with the *next explicit* generate, not on
  // the change. Sending here would burn a request per keystroke in a select.
  check("UIX02 · 귀속 변경만으로 요청이 나가지 않음", start.requests, afterAttribution.requests);
  record("UIX02 귀속", JSON.stringify({ group: movedChip?.group, entityId: movedChip?.entityId }));

  const pinned = await evaluate(chipPress(target, "고정"));
  await sleep(300);
  const afterPin = await evaluate(VIEW);
  const pinnedChip = afterPin.chips.find((chip) => chip.label.includes(target));
  check("UIX02 · 고정 버튼이 대상 칩에 작동", true, pinned.clicked);
  check("UIX02 · 대상 칩만 고정됨", true, pinnedChip?.pinned === true
    && afterPin.chips.filter((chip) => chip.pinned).length === 1);
  check("UIX02 · 고정 개수 갱신", 1, afterPin.counts.pinned);
  check("UIX02 · 고정 배지 표시", true, (pinnedChip?.badges ?? []).includes("고정"));
  // The pin must not disturb anyone else's attribution.
  const others = afterPin.chips.filter((chip) => !chip.label.includes(target));
  const othersBefore = start.chips.filter((chip) => !chip.label.includes(target));
  check("UIX02 · 다른 칩의 귀속은 그대로", true,
    others.length === othersBefore.length
    && others.every((chip, index) => chip.entityId === othersBefore[index].entityId));

  // Remove a different chip. `removeSelection` turns an `auto` chip into a veto rather than
  // dropping it, which is the UCP contract: the model must not re-derive what was removed.
  const other = afterPin.chips.find((chip) => !chip.label.includes(target) && chip.entityId);
  const removed = await evaluate(chipPress(other.label, "제거"));
  await sleep(300);
  const afterRemove = await evaluate(VIEW);
  check("UIX02 · 다른 칩 제거가 성공", true, removed.clicked);
  check("UIX02 · 제거한 칩이 제외로 이동", afterPin.counts.excluded + 1, afterRemove.counts.excluded);
  check("UIX02 · 제외가 늘고 선택이 줄어 합계 유지",
    afterPin.counts.chosen - 1, afterRemove.counts.chosen);
  const survivor = afterRemove.chips.find((chip) => chip.label.includes(target));
  check("UIX02 · 제거 후에도 대상 칩의 귀속·고정 유지", true,
    survivor?.entityId === "entity-1" && survivor?.pinned === true);
  check("UIX02 · 제거 후 고정 개수 유지", 1, afterRemove.counts.pinned);

  // Restore the veto. `clearExclusion` deletes the row, so the chip leaves the excluded list
  // and does *not* return as chosen — the next reply may choose it again, which is the point.
  check("UIX02 · 제외 행에 칩 ID와 출처", true,
    Boolean(afterRemove.excluded[0]?.id) && (afterRemove.excluded[0]?.badges ?? []).length > 0);
  const restoredLabel = afterRemove.excluded[0]?.label;
  await clickByText(".compose-excluded button", "제외 해제");
  await sleep(300);
  const afterRestore = await evaluate(VIEW);
  check("UIX02 · 제외 복구가 제외 개수를 줄임", 0, afterRestore.counts.excluded);
  check("UIX02 · 제외 복구는 선택을 되살리지 않음(행 제거)", afterRemove.counts.chosen,
    afterRestore.counts.chosen);
  check("UIX02 · 복구한 칩은 선택 카드에 없음", false,
    afterRestore.chips.some((chip) => chip.label === restoredLabel));
  check("UIX02 · 복구는 요청을 보내지 않음", afterRemove.requests, afterRestore.requests);
  record("UIX02 연속 조작", JSON.stringify({
    afterPin: afterPin.counts, afterRemove: afterRemove.counts, afterRestore: afterRestore.counts,
  }));
  await page.shot(shots, "uix02-01-sequence.png");

  // ── D. search and fold are view-only: no revision, no request, no reset ──────
  const beforeView = await evaluate(VIEW);
  // The panel starts folded (`panelOpen` defaults to false), so open it before searching.
  if (!beforeView.dictionaryOpen) {
    await clickByText(".compose-actions button", "사전에서 고르기");
    await sleep(350);
  }
  check("UIX02 · 사전을 열면 검색이 보임", true, (await evaluate(VIEW)).dictionaryOpen);

  await evaluate(setValue('.compose-dictionary input[type="search"]', "없는검색어zzz"));
  await sleep(350);
  const noResults = await evaluate(VIEW);
  check("UIX02 · 검색 결과 0에서 선택은 유지", beforeView.counts.chosen, noResults.counts.chosen);
  check("UIX02 · 검색 결과 수와 선택 수를 구분해 표시", true,
    noResults.searchCount.includes("검색 결과 0개") && noResults.searchCount.includes("선택"));
  check("UIX02 · 검색만으로 요청이 나가지 않음", beforeView.requests, noResults.requests);

  // The existing reset action must still be the way out of an empty result.
  const resetButtons = await evaluate(`[...document.querySelectorAll('.compose-empty-actions button')]
    .map((node) => node.textContent.trim())`);
  check("UIX02 · 빈 결과에 검색어 지우기 제공", true,
    resetButtons.includes("검색어 지우기"));
  // Only the query is narrowing the list, so the category reset must *not* be offered yet:
  // a "전체 분류 보기" button here would do nothing and read as a broken control.
  check("UIX02 · 검색만 좁혔을 때 분류 초기화는 없음", false,
    resetButtons.includes("전체 분류 보기"));

  // A category plus a query produces the same empty result, so the second reset action has
  // to exist and work on its own: clearing the query must not be the only way out.
  // Order matters — the category buttons are derived from the *filtered* entries, so the
  // category has to be chosen while it still has results, then narrowed by the query.
  // "네온" is a lighting word, so inside 의상 it matches nothing.
  await clickByText(".compose-empty-actions button", "검색어 지우기");
  await sleep(300);
  const categorySetup = await evaluate(`(() => {
    const labels = [...document.querySelectorAll('.compose-groups button')]
      .map((node) => node.textContent.trim());
    const button = [...document.querySelectorAll('.compose-groups button')]
      .find((node) => node.textContent.trim().startsWith('의상'));
    if (!button) return { clicked: false, labels };
    button.click();
    return { clicked: true, labels };
  })()`);
  await sleep(300);
  await evaluate(setValue('.compose-dictionary input[type="search"]', "네온"));
  await sleep(350);
  const categoryOnly = await evaluate(VIEW);
  check("UIX02 · 분류를 고를 수 있음", true, categorySetup.clicked === true);
  check("UIX02 · 분류와 검색이 함께 결과를 좁힘", true,
    categoryOnly.searchCount.includes("검색 결과 0개"));
  check("UIX02 · 분류 선택이 요약에 표시됨", true,
    categoryOnly.searchCount.includes("의상 분류"));
  const categoryReset = await evaluate(`[...document.querySelectorAll('.compose-empty-actions button')]
    .map((node) => node.textContent.trim())`);
  check("UIX02 · 분류만 좁힌 빈 결과에 전체 분류 보기", true,
    categoryReset.includes("전체 분류 보기"));
  await clickByText(".compose-empty-actions button", "전체 분류 보기");
  await sleep(350);
  const categoryCleared = await evaluate(VIEW);
  check("UIX02 · 전체 분류 보기가 분류를 해제", false,
    categoryCleared.searchCount.includes("분류"));
  check("UIX02 · 분류 초기화도 선택을 바꾸지 않음", beforeView.counts.chosen,
    categoryCleared.counts.chosen);
  check("UIX02 · 분류 초기화도 요청을 보내지 않음", beforeView.requests,
    categoryCleared.requests);

  // Now the query reset, from a query-only empty result.
  await evaluate(setValue('.compose-dictionary input[type="search"]', "없는검색어zzz"));
  await sleep(350);
  await clickByText(".compose-empty-actions button", "검색어 지우기");
  await sleep(350);
  const cleared = await evaluate(VIEW);
  check("UIX02 · 검색어 지우기가 결과를 되돌림", true,
    cleared.searchCount.includes("검색 결과 0개") === false);
  check("UIX02 · 검색 초기화도 선택을 바꾸지 않음", beforeView.counts.chosen,
    cleared.counts.chosen);

  // Fold, refold, reopen: the selection is untouched and nothing was sent.
  await clickByText(".compose-actions button", "사전 접기");
  await sleep(300);
  const folded = await evaluate(VIEW);
  check("UIX02 · 접힌 상태에서 선택 요약은 그대로", JSON.stringify(beforeView.counts),
    JSON.stringify(folded.counts));
  check("UIX02 · 접힌 상태에서 사전 영역이 사라짐", false, folded.dictionaryOpen);
  check("UIX02 · 접기만으로 요청이 나가지 않음", beforeView.requests, folded.requests);
  // The counts are only useful if they are *readable* while folded. Scroll the bar into
  // view and measure it: present in the DOM but below the fold would pass a selector check
  // and fail the user.
  const foldedBar = await evaluate(`(() => {
    const bar = document.querySelector('.compose-counts');
    if (!bar) return { visible: false };
    bar.scrollIntoView({ block: 'center' });
    const rect = bar.getBoundingClientRect();
    const nodes = [...bar.querySelectorAll('.compose-count')];
    return {
      visible: rect.height > 0 && rect.width > 0,
      inViewport: rect.top >= -1 && rect.bottom <= innerHeight + 1,
      parts: nodes.map((node) => (node.textContent ?? '').replace(/\\s+/g, ' ').trim()),
      // Every number the task names must be readable text, not a colour alone.
      numbered: nodes.length === 4 && nodes.every(
        (node) => Number(node.querySelector('strong')?.textContent) >= 0),
      openPanel: !!document.querySelector('#compose-dictionary'),
    };
  })()`);
  check("UIX02 · 접힌 상태에서 요약이 화면에 보임", true,
    foldedBar.visible && foldedBar.inViewport);
  check("UIX02 · 접힌 상태에서도 네 숫자가 읽힘", true, foldedBar.numbered);
  check("UIX02 · 요약은 사전 접힘과 무관하게 존재", false, foldedBar.openPanel);
  record("UIX02 접힌 요약", JSON.stringify(foldedBar));
  await page.shot(shots, "uix02-04-folded-counts.png");
  await clickByText(".compose-actions button", "사전에서 고르기");
  await sleep(300);
  const reopened = await evaluate(VIEW);
  check("UIX02 · 재열기 후 선택이 보존됨", JSON.stringify(beforeView.counts),
    JSON.stringify(reopened.counts));
  check("UIX02 · 재열기 후 칩 목록이 동일",
    JSON.stringify(beforeView.chips.map((chip) => chip.label)),
    JSON.stringify(reopened.chips.map((chip) => chip.label)));
  check("UIX02 · 재열기까지 요청 증가 없음", beforeView.requests, reopened.requests);
  record("UIX02 검색·접기", JSON.stringify({
    chosen: reopened.counts.chosen, requests: reopened.requests,
  }));

  // ── E. a clash shows its chip and its resolutions together, and the bar follows ─
  // A clash needs a live veto whose concept the brief mentions. Removing a chip is how a
  // user creates that veto, so the sequence mirrors what the user actually does.
  const clashSource = (await evaluate(VIEW)).chips.find((chip) => chip.label === "거리");
  check("UIX02 · 충돌 준비용 칩 존재", true, Boolean(clashSource));
  if (clashSource) {
    await evaluate(chipPress("거리", "제거"));
    await sleep(300);
    const vetoed = await evaluate(VIEW);
    check("UIX02 · 제거로 제외 1건 생성", 1, vetoed.counts.excluded);
    check("UIX02 · 제외 1건은 미해결 충돌이 아님(아직)", 0, vetoed.counts.clashes);

    // Now restate the vetoed concept in the brief: that is the contradiction.
    await evaluate(setValue("#compose-brief", `${FREE_TEXT} 거리에서 기다린다`));
    await sleep(700);
    const clashView = await evaluate(VIEW);
    const row = clashView.clashRows[0];
    check("UIX02 · 충돌 요약 건수가 올라감", 1, clashView.counts.clashes);
    check("UIX02 · 충돌 행이 당사 항목을 이름으로 표시", true,
      Boolean(row) && row.label.length > 0);
    check("UIX02 · 충돌 행이 인용 문구를 함께 보여 줌", true,
      Boolean(row) && row.phrase.includes("원문에"));
    check("UIX02 · 해소 동작이 당사 항목 안에 있음", true,
      Boolean(row) && row.buttonsInside
      && JSON.stringify(row.buttons) === JSON.stringify(["제외 해제", "원문에서 지우기"]));
    record("UIX02 충돌", JSON.stringify(clashView.clashRows));
    await page.shot(shots, "uix02-02-clash.png");

    if (row) {
      // Resolve through the row's own button, the same control a user presses.
      await evaluate(`(() => {
        const node = [...document.querySelectorAll('.compose-clashes li')]
          .find((li) => li.getAttribute('data-chip-id') === ${JSON.stringify(row.id)});
        const button = node && [...node.querySelectorAll('button')]
          .find((b) => b.textContent.includes('제외 해제'));
        if (button) button.click();
        return !!button;
      })()`);
      await sleep(450);
      const resolved = await evaluate(VIEW);
      check("UIX02 · 충돌 해소 후 요약 건수 0", 0, resolved.counts.clashes);
      check("UIX02 · 충돌 해소가 제외 목록도 비움", 0, resolved.counts.excluded);
      // Resolving the veto re-adds what the brief asked for: the model may choose it again.
      check("UIX02 · 충돌 해소는 요청을 보내지 않음", clashView.requests, resolved.requests);
      record("UIX02 충돌 해소", JSON.stringify(resolved.counts));
    }
  }

  // ── F. a failure and its retry keep the user's decisions ─────────────────────
  // The claim is not "the count is identical" — a fresh reply legitimately re-derives the
  // auto chips. It is that what the *user* decided survives: the pin and its attribution.
  const beforeFail = await evaluate(VIEW);
  await evaluate(`window.__composeMode = "fail"`);
  await click(".compose-generate");
  await sleep(1000);
  await evaluate(`window.__composeMode = "ready"`);
  const failed = await evaluate(VIEW);
  check("UIX02 · 실패가 선택 요약을 초기화하지 않음",
    JSON.stringify(beforeFail.counts), JSON.stringify(failed.counts));
  const retryVisible = await evaluate(
    `[...document.querySelectorAll('.compose-actions button')].some((n) => n.textContent.includes('다시 시도'))`);
  check("UIX02 · 실패 후 재시도 제공", true, retryVisible);
  if (retryVisible) {
    await clickByText(".compose-actions button", "다시 시도");
    await sleep(1200);
    const recovered = await evaluate(VIEW);
    const kept = recovered.chips.find((chip) => chip.label.includes("네온"));
    // The pin is the user's decision and must survive. Attribution is deliberately *not*
    // asserted against entity-1: `mergeSelections` prefers the server's attribution for an
    // auto chip because it is derived from the current brief, so a fresh reply may put the
    // chip back on the person the sentence names. That is the UCP contract, not a reset.
    check("UIX02 · 재시도 후에도 고정이 유지", true, kept?.pinned === true);
    check("UIX02 · 재시도 후에도 고정 개수 1", 1, recovered.counts.pinned);
    check("UIX02 · 재시도 후 귀속은 서버 파생값", "entity-2", kept?.entityId);
    record("UIX02 실패·재시도", JSON.stringify({ counts: recovered.counts,
      kept: { pinned: kept?.pinned, entityId: kept?.entityId } }));
  }

  // ── G. detail controls are identifiable per chip at both widths ─────────────
  for (const [width, height] of [[360, 740], [390, 844], [1280, 900]]) {
    await page.viewport(width, height, width < 500);
    await sleep(450);
    const layout = await evaluate(`(() => {
      const chips = [...document.querySelectorAll('.compose-chip')];
      const identifiable = chips.length > 0 && chips.every((chip) => {
        const label = chip.querySelector('.compose-chip__label')?.textContent?.trim() ?? "";
        const named = chip.querySelector('.compose-chip__actions')?.getAttribute('aria-label') ?? "";
        // The control group must name the chip it edits, not merely exist.
        return label.length > 0 && named.startsWith(label);
      });
      const heights = chips.flatMap((chip) => [...chip.querySelectorAll('button')])
        .map((button) => Math.round(button.getBoundingClientRect().height));
      // The attribution select's label must read as one word. A wrapped "대 상" is a
      // vertical label a user has to decode, so its box is checked for one line's height.
      const attributeLabels = chips.flatMap((chip) =>
        [...chip.querySelectorAll('.compose-chip__attribute-label')])
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const line = parseFloat(getComputedStyle(node).lineHeight) || 0;
          return { width: Math.round(rect.width), height: Math.round(rect.height), line };
        });
      const labelsOnOneLine = attributeLabels.length === 0 || attributeLabels.every(
        (item) => item.line === 0 || item.height <= item.line * 1.5 + 2);
      const bar = document.querySelector('.compose-counts')?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        identifiable,
        minButton: heights.length ? Math.min(...heights) : null,
        barInside: Boolean(bar) && bar.right <= innerWidth + 1,
        labelsOnOneLine,
      };
    })()`);
    check(`UIX02 · ${width}px 가로 넘침 없음`, true, layout.overflow <= 1);
    check(`UIX02 · ${width}px 상세 조작 대상 식별`, true, layout.identifiable);
    check(`UIX02 · ${width}px 버튼 44px 이상`, true,
      layout.minButton !== null && layout.minButton >= 44);
    check(`UIX02 · ${width}px 요약이 화면 안에`, true, layout.barInside);
    // "대상" must stay one word at both widths; a stacked label is unreadable, not compact.
    check(`UIX02 · ${width}px 귀속 라벨이 한 줄`, true, layout.labelsOnOneLine);
    record(`UIX02 ${width}px`, JSON.stringify(layout));
    // Frame the compose panel itself: the evidence is the chip cards and the counts bar,
    // and an unscrolled shot at 360px lands on the job queue instead.
    await evaluate(`(() => {
      const chips = document.querySelector('.compose-chips');
      if (chips) chips.scrollIntoView({ block: 'center' });
      return !!chips;
    })()`);
    await sleep(350);
    await page.shot(shots, `uix02-03-${width}.png`);
  }
  await page.viewport(1280, 900, false);
  await sleep(300);
}
