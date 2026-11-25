/**
 * UCP08 in a real browser: the integrated compose panel, end to end.
 *
 * What is real: the DOM and every event (real key events, real clicks), the React state
 * machine, the image-submission path (`POST /api/v1/jobs`), SQLite in the disposable data
 * dir, and the HTTP read-back (`/assets/{id}/metadata`, `/jobs/{id}/events`).
 *
 * What is NOT real: the compose *reply*. `prompt_compose` is advertised only when the
 * engine is not `fake` (`compose_advertised`), and this harness runs `STUDIO_ENGINE=fake`
 * with no gate. So the capability block and `POST /prompt/compose` are stubbed in the
 * page — the same approach TRANS06/U12 already use. Nothing here is a model result, and
 * no assertion below is evidence of translation or scene-parsing quality.
 *
 * That split is the point: the stub decides *what the server would have said*, and every
 * assertion is about what the browser does with it. Applied prompts reaching the image
 * request as a v3 snapshot, the overwrite guard, staleness and undo are real paths.
 *
 * Blocks A–V. The mobile results come from CDP viewport emulation, which is layout evidence
 * only: it says nothing about a real iOS/Android keyboard, safe area or IME.
 *
 * Two blocks exist to cover paths the UI cannot reach by itself, and they are the only places
 * where a *server answer* is stubbed rather than the compose reply: K2 edits only the negative
 * field before undoing (pinning that a record which disagrees with the fields is not restored),
 * and V feeds a deterministic `413` on save and a stored row carrying `snapshot_trim`. V is
 * therefore *client error-display* evidence, not evidence that the server's trim ladder ran —
 * that lives in `backend/tests/test_prompt_composition_v3.py`.
 */
import { openBuilder } from "./ui.mjs";
/*
 * The panel's user-facing copy is imported from the shipping modules rather than retyped
 * here. A browser test that hardcodes the sentence it expects cannot tell "the UI changed"
 * from "the test is stale", and a copy edit would silently turn a real assertion into a
 * tautology once someone updated the string in both places.
 */
import { failureAlert } from "../../frontend/src/prompt/composeAlerts.ts";
import { APPLY_BLOCK_COPY } from "../../frontend/src/prompt/composeApply.ts";

const FREE_TEXT = "비 오는 골목에 서 있는 여성";
const EDITED_TEXT = `${FREE_TEXT} 뒤돌아보며`;
const PROMPT_A = "a woman standing on a rainy alley, neon lighting";
const PROMPT_B = "rainy alley, a standing woman, back view";
const PROMPT_C = "a woman, rainy alley, cinematic framing";

/** Calls the app's own API with the credential the app itself sent (as U12 does). */
const api = (expression) => `(async () => {
  const headers = { 'Content-Type': 'application/json' };
  if (window.__authHeader) headers.Authorization = window.__authHeader;
  ${expression}
})()`;

/** The scene the stub reports, with two people so attribution has somewhere to go. */
const sceneWith = (extra = {}) => ({
  entities: [
    { entity_id: "entity-1", kind: "person", count: 1,
      attributes_ko: ["검은 머리"], evidence_ko: "여성" },
    { entity_id: "entity-2", kind: "person", count: 1,
      attributes_ko: ["파란 코트"], evidence_ko: "남성" },
  ],
  relations: [{ subject_entity_id: "entity-1", predicate_ko: "기다린다",
    object_entity_id: "entity-2", evidence_ko: "기다리는" }],
  environment: { location_ko: "비 오는 골목", time_ko: "밤", lighting_ko: "네온" },
  unmapped_details: [{ text_ko: "젖은 우산", entity_id: "entity-1" }],
  ambiguities: [],
  ...extra,
});

/** One well-formed `ready` reply; candidates differ only in their English text. */
const readyReply = (over = {}) => ({
  result_id: "cmp-ucp08-0001",
  status: "ready",
  summary_ko: "비 오는 골목에 선 여성과 기다리는 남성",
  scene: sceneWith(),
  selections: [
    { id: "subject.person", source: "auto", pinned: false, entity_id: "entity-1" },
    { id: "action.standing", source: "auto", pinned: false, entity_id: "entity-1" },
    { id: "lighting.neon", source: "auto", pinned: false },
    { id: "location.street", source: "auto", pinned: false },
  ],
  candidates: [
    { candidate_id: "cand-a", title_ko: "원문 충실", difference_ko: "원문 그대로",
      positive_prompt: PROMPT_A, negative_prompt: "blurry, text",
      preserved_ko: ["비 오는 골목"] },
    { candidate_id: "cand-b", title_ko: "구도 강조", difference_ko: "뒤에서 본 구도",
      positive_prompt: PROMPT_B, negative_prompt: null, preserved_ko: [] },
    { candidate_id: "cand-c", title_ko: "영화적", difference_ko: "조명을 더 강하게",
      positive_prompt: PROMPT_C, negative_prompt: null, preserved_ko: ["네온"] },
  ],
  clarifications: [],
  warnings: [],
  snapshot_trim: [],
  provider: { model: "stub-compose", finish_reason: "stop" },
  ...over,
});

const DEFAULT_REPLY = readyReply();

/** Job count straight from the API, so "did it submit?" is not read from the DOM. */
const JOB_COUNT = api(`
  const jobs = await (await fetch('/api/v1/jobs?limit=100', { headers })).json();
  return jobs.length;
`);

/** Sets a React-controlled field the way a user's keystroke would. */
const setValue = (selector, value) => `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return null;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')
    .set.call(node, ${JSON.stringify(value)});
  node.dispatchEvent(new Event('input', { bubbles: true }));
  return node.value;
})()`;

/**
 * Installs the compose capability + endpoint stub. Runs on every new document, so a
 * reload inside this suite keeps the same contract.
 *
 * `window.__composeMode` selects the answer:
 *   "ready"        → `window.__composeReply` (or DEFAULT_REPLY)
 *   "clarify"      → a question with two options
 *   "unavailable"  → a provider failure the panel must degrade from
 *   "slow"         → a reply held until `window.__release()` is called
 */
async function installComposeStub(page) {
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = window.fetch;
    const DEFAULT_REPLY = ${JSON.stringify(DEFAULT_REPLY)};
    window.__composeCalls = [];
    window.__composeMode = "ready";
    window.__composeReply = null;
    let release = null;
    window.__hold = () => new Promise((resolve) => { release = resolve; });
    window.__release = () => { if (release) { release(); release = null; } };
    const json = (body) => new Response(JSON.stringify(body), { status: 200,
      headers: { "Content-Type": "application/json" } });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/system/capabilities")) {
        const response = await real(input, init);
        const body = await response.json().catch(() => ({}));
        // The fake engine does not advertise prompt_compose (compose_advertised), so the
        // panel would stay in its fallback state and every check below would be vacuous.
        body.prompt_compose = {
          schema_versions: [1],
          dictionary_version: "1.2.0",
          output_profile_versions: { sd15: 2, flux2: 2, "z-image": 2, "moss-image": 2 },
          timeout_ms: 60000, max_candidates: 3,
          max_request_bytes: 24576, max_response_bytes: 49152,
        };
        body.prompt_composition = { schema_versions: [1, 2, 3] };
        return new Response(JSON.stringify(body), { status: response.status,
          headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/prompt/compose")) {
        const body = JSON.parse(init.body);
        window.__composeCalls.push(body);
        const mode = window.__composeMode;
        if (mode === "slow") await window.__hold();
        if (init && init.signal && init.signal.aborted) {
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        }
        const ids = { result_id: "cmp-ucp08-0001", request_id: body.request_id,
          provider: { model: "stub-compose", finish_reason: "stop" } };
        if (mode === "clarify") {
          return json({ ...ids, status: "needs_clarification", summary_ko: "",
            scene: { entities: [], relations: [], environment: {},
              unmapped_details: [], ambiguities: [] }, candidates: [],
            clarifications: [{ question_id: "q1", question_ko: "누가 우산을 들고 있나요?",
              why: "actor_unknown",
              options: [{ option_id: "o1", label_ko: "여성" },
                { option_id: "o2", label_ko: "남성" }] }],
            selections: [], warnings: [], snapshot_trim: [] });
        }
        if (mode === "unavailable") {
          // The real route sends "why", not "failure" (compose.py error_body), and the
          // patient client maps "why" -> its own category. Sending "failure" would silently
          // exercise the unknown-code fallback instead of the intended one.
          return json({ ...ids, status: "unavailable", why: "gpu_unavailable",
            message: "지금은 LLM을 사용할 수 없습니다" });
        }
        const reply = window.__composeReply ?? DEFAULT_REPLY;
        return json({ ...reply, result_id: ids.result_id,
          request_id: ids.request_id, provider: ids.provider });
      }
      return real(input, init);
    };
  })();` });
}


/** The panel's own view of its state, read from the DOM the user actually sees. */
const SNAPSHOT = `(() => {
  const chips = [...document.querySelectorAll('.compose-chip')].map((node) => ({
    label: node.querySelector('.compose-chip__label')?.textContent ?? null,
    source: node.getAttribute('data-source'),
    pinned: node.hasAttribute('data-pinned'),
    badges: [...node.querySelectorAll('.compose-chip__badge')].map((b) => b.textContent),
    entity: node.querySelector('.compose-chip__entity')?.textContent ?? null,
    attributedTo: node.querySelector('select') ? node.querySelector('select').value : null,
  }));
  return {
    panel: !!document.querySelector('.compose'),
    brief: document.querySelector('#compose-brief')?.value ?? null,
    status: document.querySelector('#compose-status')?.textContent?.trim() ?? null,
    fallback: document.querySelector('.compose-fallback')?.textContent?.trim() ?? null,
    chips,
    excluded: [...document.querySelectorAll('.compose-excluded li')]
      .map((node) => node.textContent.trim()),
    summary: document.querySelector('.compose-summary')?.textContent ?? null,
    unmapped: [...document.querySelectorAll('.compose-notice li')].map((n) => n.textContent),
    entityLine: [...document.querySelectorAll('.compose-scene .compose-meta')]
      .map((n) => n.textContent).find((t) => t && t.includes('장면 대상')) ?? null,
    candidates: [...document.querySelectorAll('.compose-candidate')].map((node) => ({
      title: node.querySelector('h4')?.textContent ?? null,
      prompt: node.querySelector('.compose-candidate__prompt')?.textContent ?? null,
      negative: node.querySelector('.compose-candidate__negative')?.textContent ?? null,
      difference: node.querySelector('.compose-candidate__difference')?.textContent ?? null,
      diff: node.querySelector('.compose-candidate__diff')?.textContent ?? null,
      applied: node.hasAttribute('data-applied'),
      applyDisabled: !!node.querySelector('.compose-apply')?.disabled,
    })),
    clarify: document.querySelector('.compose-clarify')
      ? [...document.querySelectorAll('.compose-question button')].map((n) => n.textContent)
      : [],
    alerts: [...document.querySelectorAll('.compose-alert')].map((node) => ({
      category: node.getAttribute('data-category'),
      title: node.querySelector('strong')?.textContent ?? null,
      message: node.querySelector('span')?.textContent ?? null,
    })),
    staleNotice: [...document.querySelectorAll('.compose-results .compose-notice')]
      .map((n) => n.textContent).join(' ') || null,
    undo: !!document.querySelector('.compose-undo button'),
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
    negative: document.querySelector('.composer textarea[rows="2"]')?.value ?? null,
  };
})()`;

/** One click on the button whose aria-label ends with `suffix`, inside a chip. */
const clickChipButton = (chipMatch, suffix) => `(() => {
  const chip = [...document.querySelectorAll('.compose-chip')]
    .find((node) => (node.textContent || '').includes(${JSON.stringify(chipMatch)}));
  if (!chip) return null;
  const button = [...chip.querySelectorAll('button')]
    .find((node) => (node.getAttribute('aria-label') || '').endsWith(${JSON.stringify(suffix)}));
  const label = button?.getAttribute('aria-label') ?? null;
  if (button) button.click();
  return { clicked: !!button, label };
})()`;


export async function runUcp08({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select, press, shot } = page;

  await installComposeStub(page);
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.prompt-builder > .quiet')`,
    { label: "reload for UCP08", timeout: 20000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "models after reload", timeout: 20000 });
  await select(".composer select", "fake-sd15");
  await sleep(600);
  await openBuilder(page);
  await waitFor(`!!document.querySelector('.compose')`,
    { label: "compose panel", timeout: 20000 });

  // ── A. the panel renders, with no fallback when the capability is present ──────
  const initial = await evaluate(SNAPSHOT);
  check("UCP08 · ComposePanel 렌더링", true, initial.panel);
  check("UCP08 · 지원 시 폴백 문구 없음", null, initial.fallback);
  check("UCP08 · 초기에는 후보 없음", 0, initial.candidates.length);
  check("UCP08 · 초기 생성 버튼 비활성", true,
    await evaluate(`document.querySelector('.compose-generate').disabled`));
  record("UCP08 초기", JSON.stringify({ brief: initial.brief, status: initial.status,
    fallback: initial.fallback }));
  await shot(shots, "20-compose-panel.png");

  // ── B. Korean input, and Enter must not submit the image form ──────────────────
  await typeInto("#compose-brief", FREE_TEXT);
  await sleep(200);
  const typed = await evaluate(SNAPSHOT);
  check("UCP08 · 한글 장면 입력 반영", FREE_TEXT, typed.brief);
  check("UCP08 · 입력만으로 후보 요청 없음", 0,
    await evaluate(`window.__composeCalls.length`));
  check("UCP08 · 입력 후 생성 버튼 활성", false,
    await evaluate(`document.querySelector('.compose-generate').disabled`));

  // A real Enter keydown inside the textarea. The panel sits inside App's <form>, so an
  // unhandled Enter would be an implicit submit and create a job.
  const jobsBeforeEnter = await evaluate(JOB_COUNT);
  await evaluate(`document.querySelector('#compose-brief').focus()`);
  await press("Enter", "Enter", 13);
  await sleep(700);
  const jobsAfterEnter = await evaluate(JOB_COUNT);
  const afterEnter = await evaluate(`(() => ({
    brief: document.querySelector('#compose-brief').value,
    calls: window.__composeCalls.length,
  }))()`);
  check("UCP08 · Enter가 이미지 생성 폼을 제출하지 않음", jobsBeforeEnter, jobsAfterEnter);
  check("UCP08 · Enter가 후보 요청을 보내지 않음", 0, afterEnter.calls);
  check("UCP08 · Enter 후 입력 유지", true, afterEnter.brief.startsWith(FREE_TEXT));
  record("UCP08 Enter", JSON.stringify({ jobsBeforeEnter, jobsAfterEnter,
    newline: afterEnter.brief.includes("\n") }));

  // IME composition: the Enter that confirms a Hangul composition must be swallowed too.
  // Synthesised the way the browser reports it mid-composition (isComposing + keyCode 229).
  const ime = await evaluate(`(() => {
    const node = document.querySelector('#compose-brief');
    node.focus();
    const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229,
      bubbles: true, cancelable: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    const notCancelled = node.dispatchEvent(event);
    return { cancelled: !notCancelled, value: node.value };
  })()`);
  check("UCP08 · 조합 중 Enter 취소", true, ime.cancelled);
  check("UCP08 · 조합 중 Enter로 문자 유실 없음", true, ime.value.startsWith(FREE_TEXT));
  check("UCP08 · 조합 중 Enter로 요청 없음", 0,
    await evaluate(`window.__composeCalls.length`));
  record("UCP08 IME", JSON.stringify({ cancelled: ime.cancelled,
    valueLength: ime.value.length }));

  // ── C. Korean dictionary search keeps state and never submits ──────────────────
  const searchOpened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.compose-actions button')]
      .find((node) => node.textContent.includes('사전'));
    if (button) button.click();
    return !!button;
  })()`);
  await waitFor(`!!document.querySelector('#compose-dictionary')`,
    { label: "dictionary panel", timeout: 5000 });
  check("UCP08 · 사전 패널 열림", true, searchOpened);
  check("UCP08 · 분류 버튼 노출", true,
    await evaluate(`document.querySelectorAll('.compose-groups button').length`) > 1);

  await typeInto("#compose-dictionary input[type=search]", "네온");
  await sleep(300);
  const found = await evaluate(`(() => ({
    options: [...document.querySelectorAll('.compose-option span')].map((n) => n.textContent),
    count: document.querySelectorAll('.compose-option').length,
    group: [...document.querySelectorAll('.compose-groups button')]
      .find((n) => n.getAttribute('aria-pressed') === 'true')?.textContent ?? null,
  }))()`);
  check("UCP08 · 한글 사전 검색이 결과를 좁힘", true, found.count > 0 && found.count < 20);
  check("UCP08 · 검색 결과에 네온 포함", true,
    found.options.some((label) => (label ?? "").includes("네온")));
  check("UCP08 · 검색이 분류 선택을 바꾸지 않음", true, (found.group ?? "").includes("전체"));
  record("UCP08 사전 검색", JSON.stringify(found));

  // Enter in the search box must be swallowed: the list filters per keystroke, and the
  // input lives inside App's image form where a bare Enter is an implicit submit.
  const jobsBeforeSearchEnter = await evaluate(JOB_COUNT);
  await evaluate(`document.querySelector('#compose-dictionary input[type=search]').focus()`);
  await press("Enter", "Enter", 13);
  await sleep(600);
  check("UCP08 · 사전 검색 Enter가 생성 폼을 제출하지 않음",
    jobsBeforeSearchEnter, await evaluate(JOB_COUNT));

  // ── D. manual pick, then one compose reply ─────────────────────────────────────
  const manualPick = await evaluate(`(() => {
    const option = [...document.querySelectorAll('.compose-option')]
      .find((node) => (node.textContent || '').includes('네온'));
    const countBefore = document.querySelector('.compose-groups button .compose-group-count')
      ?.textContent ?? null;
    if (option) option.click();
    return { clicked: !!option, countBefore };
  })()`);
  await sleep(300);
  // Before a reply there is no draft, and the chip list is part of the interpretation section
  // (`visible.draft && …`). The pick is therefore visible through the dictionary itself: the
  // option becomes pressed and the "전체" count grows. Claiming a chip here would be asserting
  // UI that does not exist.
  const picked = await evaluate(`(() => {
    const option = [...document.querySelectorAll('.compose-option')]
      .find((node) => (node.textContent || '').includes('네온'));
    return {
      pressed: option?.getAttribute('aria-pressed') ?? null,
      count: document.querySelector('.compose-groups button .compose-group-count')
        ?.textContent ?? null,
      chips: document.querySelectorAll('.compose-chip').length,
    };
  })()`);
  check("UCP08 · 사전 항목 클릭으로 선택", true, manualPick.clicked);
  check("UCP08 · 선택한 항목이 눌린 상태로 표시", "true", picked.pressed);
  check("UCP08 · 선택 수에 반영", true,
    Number(picked.count) === Number(manualPick.countBefore) + 1);
  check("UCP08 · 응답 전에는 칩 목록이 없음", 0, picked.chips);

  await evaluate(`window.__composeReply = ${JSON.stringify(readyReply())};`);
  await click(".compose-generate");
  await waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "three candidates", timeout: 20000 });
  await sleep(300);
  const ready = await evaluate(SNAPSHOT);
  check("UCP08 · 후보 3개 표시", 3, ready.candidates.length);
  check("UCP08 · 첫 후보는 '원문 충실'", true,
    (ready.candidates[0]?.title ?? "").includes("원문 충실"));
  check("UCP08 · 후보 본문 노출", PROMPT_A, ready.candidates[0]?.prompt);
  check("UCP08 · 차이 설명 노출", "원문 그대로", ready.candidates[0]?.difference);
  check("UCP08 · 요약 노출", true, (ready.summary ?? "").includes("비 오는 골목"));
  check("UCP08 · 후보별 diff 문구", true,
    (ready.candidates[0]?.diff ?? "").includes("최종 프롬프트"));

  const sentBody = await evaluate(`window.__composeCalls[window.__composeCalls.length - 1]`);
  // The brief carries the newline the earlier plain-Enter test legitimately inserted, so
  // this compares the text and not the whitespace around it.
  check("UCP08 · 요청이 한글 원문을 담음", FREE_TEXT, (sentBody?.brief_ko ?? "").trim());
  check("UCP08 · 요청이 manual 출처를 보존", true,
    (sentBody?.selections ?? []).some((item) => item.source === "manual"));
  check("UCP08 · 요청이 대상 모델/프로필을 담음", true,
    sentBody?.target_family === "sd15" && sentBody?.profile_version === 2);
  record("UCP08 요청 본문", JSON.stringify({
    brief: sentBody?.brief_ko, selections: sentBody?.selections,
    target: `${sentBody?.target_model_id}/${sentBody?.target_family}/${sentBody?.profile_version}`,
    candidate_count: sentBody?.candidate_count,
  }));

  // ── E. chip states: auto / pinned / excluded / attribution ─────────────────────
  check("UCP08 · 자동 칩 출처 표시", true,
    ready.chips.some((chip) => chip.source === "auto"));
  check("UCP08 · 칩에 대상 귀속 표시", true,
    ready.chips.some((chip) => (chip.entity ?? "").startsWith("인물")));
  check("UCP08 · 개체/관계 수 표시", true,
    (ready.entityLine ?? "").includes("장면 대상 2개"));
  check("UCP08 · 사전 미등록 디테일 보존", true,
    (ready.unmapped ?? []).some((text) => (text ?? "").includes("젖은 우산")));

  // Pin one chip with a real click on the 고정 button a user would press.
  const pinClick = await evaluate(`(() => {
    const chip = [...document.querySelectorAll('.compose-chip')]
      .find((node) => node.getAttribute('data-source') === 'auto' && node.querySelector('select'));
    const button = chip && [...chip.querySelectorAll('button')]
      .find((node) => node.textContent.trim() === '고정');
    if (button) button.click();
    return !!button;
  })()`);
  await sleep(300);
  const pinned = await evaluate(SNAPSHOT);
  const pinnedChip = pinned.chips.find((chip) => chip.pinned);
  check("UCP08 · 고정 버튼 동작", true, pinClick);
  check("UCP08 · 고정 후 고정 상태 표시", true, Boolean(pinnedChip));
  check("UCP08 · 고정 배지 표시", true, (pinnedChip?.badges ?? []).includes("고정"));

  // Re-attribute a chip to the other person through the select a user would use.
  const attribution = await evaluate(`(() => {
    const chip = [...document.querySelectorAll('.compose-chip')]
      .find((node) => node.querySelector('select'));
    const select = chip && chip.querySelector('select');
    if (!select) return null;
    const options = [...select.options].map((o) => ({ value: o.value, label: o.textContent }));
    if (!options.some((o) => o.value === 'entity-2')) return { options, moved: false };
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value')
      .set.call(select, 'entity-2');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { options, moved: true };
  })()`);
  await sleep(300);
  const attributed = await evaluate(SNAPSHOT);
  check("UCP08 · 귀속 선택지에 장면 전체+두 인물", 3, attribution?.options.length);
  check("UCP08 · 귀속 변경이 화면에 반영", true, attribution?.moved
    && attributed.chips.some((chip) => chip.attributedTo === "entity-2"));
  check("UCP08 · 귀속 라벨이 인물 이름", true,
    attributed.chips.some((chip) => chip.entity === "인물 2"));
  record("UCP08 귀속", JSON.stringify({ options: attribution?.options,
    chips: attributed.chips.map((c) => `${c.label}:${c.source}:${c.attributedTo}`) }));
  await shot(shots, "21-compose-chips.png");

  // ── F. AI에게 맡기기: the only manual → auto path ──────────────────────────────
  const handBack = await evaluate(`(() => {
    const chip = [...document.querySelectorAll('.compose-chip')]
      .find((node) => node.getAttribute('data-source') === 'manual');
    const button = chip && [...chip.querySelectorAll('button')]
      .find((node) => node.textContent.includes('AI에게 맡기기'));
    const before = document.querySelectorAll('.compose-chip').length;
    if (button) button.click();
    return { found: !!button, before };
  })()`);
  await sleep(300);
  const afterHandBack = await evaluate(SNAPSHOT);
  check("UCP08 · AI에게 맡기기 버튼 존재", true, handBack.found);
  check("UCP08 · 맡긴 뒤 수동 출처가 사라짐", 0,
    afterHandBack.chips.filter((chip) => chip.source === "manual").length);
  check("UCP08 · 맡긴 칩이 사라지지 않음", handBack.before, afterHandBack.chips.length);

  // Removing an auto chip is a veto: it leaves the chosen list and is listed separately.
  const excludeClick = await evaluate(clickChipButton("네온", "제거"));
  await sleep(350);
  const excluded = await evaluate(SNAPSHOT);
  check("UCP08 · 제거 버튼으로 칩 제외", true, Boolean(excludeClick?.clicked));
  check("UCP08 · 제외 항목이 별도 목록에 남음", true, excluded.excluded.length > 0);
  check("UCP08 · 제외 후 선택 칩 감소", true,
    excluded.chips.length === afterHandBack.chips.length - 1);
  record("UCP08 제외", JSON.stringify({ label: excludeClick?.label,
    excluded: excluded.excluded }));

  // The veto must be carried on the next request, with no pin/attribution on that row.
  await click(".compose-generate");
  await sleep(800);
  const resent = await evaluate(`window.__composeCalls[window.__composeCalls.length - 1]`);
  const vetoRow = (resent?.selections ?? []).find((item) => item.source === "excluded");
  check("UCP08 · 제외가 다음 요청에 전달", true, Boolean(vetoRow));
  check("UCP08 · 제외 행에는 pin/귀속 없음", true,
    vetoRow !== undefined && vetoRow.pinned === undefined
    && vetoRow.entity_id === undefined);

  // ── G. 충돌 해결: a veto the brief contradicts is asked, never assumed ─────────
  await evaluate(setValue("#compose-brief", "네온이 비치는 골목의 여성"));
  await sleep(450);
  const clash = await evaluate(`(() => {
    const box = document.querySelector('.compose-clashes');
    if (!box) return { shown: false, buttons: [] };
    return { shown: true, buttons: [...box.querySelectorAll('button')]
      .map((n) => n.textContent.trim()) };
  })()`);
  check("UCP08 · 제외/원문 충돌 표시", true, clash.shown);
  check("UCP08 · 충돌 해결 선택지 2개", JSON.stringify(["제외 해제", "원문에서 지우기"]),
    JSON.stringify(clash.buttons));
  if (clash.shown) {
    await clickByText(".compose-clashes button", "제외 해제");
    await sleep(350);
    const clashResolved = await evaluate(`(() => ({
      clashes: document.querySelectorAll('.compose-clashes').length,
      excluded: document.querySelectorAll('.compose-excluded li').length,
      status: document.querySelector('#compose-status').textContent.trim(),
    }))()`);
    check("UCP08 · 충돌 해결 후 경고 사라짐", 0, clashResolved.clashes);
    check("UCP08 · 제외 해제가 목록에서 사라짐", 0, clashResolved.excluded);
    check("UCP08 · 충돌 해결 안내", true, clashResolved.status.includes("충돌"));
    record("UCP08 충돌 해결", JSON.stringify(clashResolved));
  }
  await shot(shots, "22-compose-clash.png");

  // ── H. 후보 만료: editing after a reply makes the shown candidates unusable ────
  await evaluate(setValue("#compose-brief", EDITED_TEXT));
  await sleep(450);
  const stale = await evaluate(SNAPSHOT);
  check("UCP08 · 편집 후 후보 만료 안내", true,
    (stale.staleNotice ?? "").includes("적용할 수 없습니다"));
  // The apply button stays enabled: expiry is enforced when it is pressed, so the press can
  // explain why rather than leaving a dead control with no reason on screen.
  const stalePress = await evaluate(`(() => {
    const button = document.querySelector('.compose-apply');
    if (!button) return null;
    button.click();
    return { disabled: button.disabled,
      status: document.querySelector('#compose-status')?.textContent?.trim() ?? null };
  })()`);
  await sleep(350);
  const staleApplied = await evaluate(`(() => ({
    status: document.querySelector('#compose-status')?.textContent?.trim() ?? null,
    applied: [...document.querySelectorAll('.compose-candidate')].some((n) => n.hasAttribute('data-applied')),
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
  }))()`);
  check("UCP08 · 만료된 후보는 적용되지 않음", false, staleApplied.applied);
  check("UCP08 · 만료된 후보 적용 시 사유 안내", true,
    (staleApplied.status ?? "").includes("바뀌어"));
  check("UCP08 · 만료 후에도 최종 프롬프트 유지", "", staleApplied.finalPrompt);
  // The refusal the press reports is the shipping stale copy, not a sentence retyped here.
  check("UCP08 · 만료 거부 문구가 stale 계약", APPLY_BLOCK_COPY.stale, staleApplied.status);
  record("UCP08 만료", JSON.stringify({ notice: stale.staleNotice,
    applyDisabled: stalePress?.disabled, applyStatus: staleApplied.status }));

  // ── I. 후보 비교와 명시적 적용 ────────────────────────────────────────────────
  await evaluate(`window.__composeReply = ${JSON.stringify(readyReply())};`);
  await click(".compose-generate");
  await waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "fresh candidates", timeout: 20000 });
  await sleep(300);
  const fresh = await evaluate(SNAPSHOT);
  check("UCP08 · 재생성 후 후보 적용 가능", true,
    fresh.candidates.every((c) => !c.applyDisabled));
  check("UCP08 · 만료 안내가 사라짐", null, fresh.staleNotice);

  // The final prompt is empty, so applying needs no confirmation.
  await evaluate(`window.__confirmCalls = 0;
    window.confirm = () => { window.__confirmCalls += 1; return true; };`);
  await clickByText(".compose-candidate .compose-apply", "이 프롬프트 사용");
  await sleep(450);
  const applied = await evaluate(SNAPSHOT);
  check("UCP08 · 적용이 최종 프롬프트를 교체", PROMPT_A, applied.finalPrompt);
  check("UCP08 · 적용 후 카드가 적용됨 표시", true,
    applied.candidates.some((c) => c.applied));
  check("UCP08 · 빈 프롬프트 교체는 확인 없음", 0,
    await evaluate(`window.__confirmCalls`));
  check("UCP08 · 적용 후 되돌리기 버튼", true, applied.undo);
  record("UCP08 적용", JSON.stringify({ finalPrompt: applied.finalPrompt,
    negative: applied.negative }));

  // Re-applying the same candidate must not ask: the field is still the panel's string.
  await clickByText(".compose-candidate .compose-apply", "이 프롬프트 사용");
  await sleep(350);
  check("UCP08 · 같은 후보 재적용은 확인 없음", 0,
    await evaluate(`window.__confirmCalls`));

  // A *different* candidate over panel-written text: still no confirmation (§3 규칙).
  await clickByText(".compose-candidate:nth-of-type(2) .compose-apply", "이 프롬프트 사용");
  await sleep(400);
  const second = await evaluate(SNAPSHOT);
  check("UCP08 · 다른 후보 적용이 본문 교체", PROMPT_B, second.finalPrompt);
  check("UCP08 · 패널이 쓴 문자열 교체는 확인 없음", 0,
    await evaluate(`window.__confirmCalls`));

  // ── J. 기존 positive/negative prompt 덮어쓰기 보호 ─────────────────────────────
  // The user types over the panel's string, so the next apply must ask first — and a
  // refusal must leave both fields exactly as the user left them.
  await evaluate(`(() => {
    const pos = document.querySelector('.composer textarea[rows="5"]');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pos), 'value')
      .set.call(pos, 'my own carefully written prompt');
    pos.dispatchEvent(new Event('input', { bubbles: true }));
    const neg = document.querySelector('.composer textarea[rows="2"]');
    if (neg) {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(neg), 'value')
        .set.call(neg, 'my own negative');
      neg.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  })()`);
  await sleep(350);
  await evaluate(`window.__confirmCalls = 0; window.__confirmAnswer = false;
    window.confirm = () => { window.__confirmCalls += 1; return window.__confirmAnswer; };`);
  await clickByText(".compose-candidate .compose-apply", "이 프롬프트 사용");
  await sleep(400);
  const refused = await evaluate(SNAPSHOT);
  check("UCP08 · 직접 수정 후 적용은 확인을 요구", 1,
    await evaluate(`window.__confirmCalls`));
  check("UCP08 · 확인 취소 시 프롬프트 유지", "my own carefully written prompt",
    refused.finalPrompt);
  check("UCP08 · 확인 취소 시 negative 유지", "my own negative", refused.negative);

  await evaluate(`window.__confirmCalls = 0; window.__confirmAnswer = true;`);
  await clickByText(".compose-candidate .compose-apply", "이 프롬프트 사용");
  await sleep(450);
  const confirmed = await evaluate(SNAPSHOT);
  check("UCP08 · 확인 승인 시 적용", 1, await evaluate(`window.__confirmCalls`));
  check("UCP08 · 승인 후 프롬프트 교체", PROMPT_A, confirmed.finalPrompt);
  check("UCP08 · 승인 후 negative도 후보 값", "blurry, text", confirmed.negative);
  record("UCP08 덮어쓰기", JSON.stringify({ confirmCalls: 1,
    afterCancel: refused.finalPrompt, afterConfirm: confirmed.finalPrompt }));

  // ── K. Undo: one step, back to what the field held before that apply ───────────
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".compose-undo button", "적용 되돌리기");
  await sleep(450);
  const undone = await evaluate(SNAPSHOT);
  check("UCP08 · Undo가 적용 전 문자열 복원", "my own carefully written prompt",
    undone.finalPrompt);
  // The restored text is the user's own typing, so no candidate may still claim it. This is
  // the pair of assertions that caught the real defect: `undoApply` put back the previous
  // record, which after a *second* apply was the first apply's record, so a card kept
  // saying "적용됨" for a prompt it never produced.
  check("UCP08 · Undo 후 적용 표시 해제", false,
    undone.candidates.some((c) => c.applied));
  check("UCP08 · Undo 후 버튼 사라짐", false, undone.undo);
  record("UCP08 Undo", JSON.stringify({ finalPrompt: undone.finalPrompt,
    negative: undone.negative, applied: undone.candidates.filter((c) => c.applied).length }));

  // ── K2. 적용 후 negative만 고친 뒤 되돌리기: 기록이 필드와 어긋나면 복원하지 않는다 ──
  // The unit test pins the pure function; this pins the wiring. A positive-only comparison
  // would keep the applied record here, and the v3 snapshot written afterwards would then
  // carry a `negative_prompt` that disagrees with the field on screen.
  await evaluate(setValue('.composer textarea[rows="5"]', ''));
  await clickByText(".compose-candidate .compose-apply", "이 프롬프트 사용");
  await sleep(450);
  const afterApply = await evaluate(SNAPSHOT);
  check("UCP08 · K2 기준 적용 완료", PROMPT_A, afterApply.finalPrompt);
  check("UCP08 · K2 적용 기록 negative", "blurry, text", afterApply.negative);

  // Edit *only* the negative field, then undo: the positive comes back identical, so a
  // positive-only check would keep the record and leave it contradicting the field.
  await evaluate(`
    (() => {
      const neg = document.querySelector('.composer textarea[rows="2"]');
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(neg), 'value')
        .set.call(neg, 'blurry');
      neg.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  await sleep(350);
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".compose-undo button", "적용 되돌리기");
  await sleep(500);
  const undoneNegative = await evaluate(SNAPSHOT);
  check("UCP08 · K2 되돌린 negative가 적용 전 값", "my own negative",
    undoneNegative.negative);
  // The record's own negative no longer describes the restored fields, so no card may claim
  // them — the claim would be written into v3 on the next submit.
  check("UCP08 · K2 negative가 어긋난 기록은 복원하지 않음", false,
    undoneNegative.candidates.some((c) => c.applied));
  record("UCP08 K2 negative 되돌리기", JSON.stringify({
    negative: undoneNegative.negative,
    appliedCards: undoneNegative.candidates.filter((c) => c.applied).length }));

  // ── K3. 같은 계열에서 모델만 바꾼 뒤 저장: 다른 모델의 적용 기록을 붙이지 않는다 ──────
  // `toSnapshot` guards the family, so `fake-sd15` → `fake-sd15-alt` (both sd15) used to
  // keep the record and write `target_model_id` = the new model with the old apply.
  await evaluate(`window.confirm = () => true;`);
  await evaluate(`window.__composeReply = ${JSON.stringify(readyReply())};`);
  await click(".compose-generate");
  await waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "K3 candidates", timeout: 20000 });
  await clickByText(".compose-candidate .compose-apply", "이 프롬프트 사용");
  await sleep(450);
  const appliedBeforeSwitch = await evaluate(SNAPSHOT);
  check("UCP08 · K3 전환 전 적용 완료", PROMPT_A, appliedBeforeSwitch.finalPrompt);

  const sameFamilyOther = await evaluate(`(() => {
    const select = document.querySelector('.composer select');
    const options = [...select.options].map((o) => o.value).filter(Boolean);
    // Pick a second model from the same family by reading the fixture's ids.
    return { current: select.value, options };
  })()`);
  record("UCP08 K3 모델 목록", JSON.stringify(sameFamilyOther));
  await select(".composer select", "fake-sd15-alt");
  await sleep(700);

  const switchBody = await evaluate(`(() => {
    window.__k3Bodies = [];
    const real = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/v1/jobs') && init && init.method === 'POST') {
        try { window.__k3Bodies.push(JSON.parse(init.body)); } catch (error) { /* ignore */ }
      }
      return real(input, init);
    };
    return true;
  })()`);
  check("UCP08 · K3 요청 캡처 설치", true, switchBody);
  await click("button.generate").catch(() => false);
  await sleep(900);
  const k3Bodies = await evaluate(`window.__k3Bodies ?? []`);
  const k3Body = k3Bodies.length ? k3Bodies[k3Bodies.length - 1] : null;
  // Either no v3 body at all, or a v3 body whose target is the current model *and* whose
  // applied record is therefore absent. What must never happen is a v3 body carrying the
  // previous model's apply.
  const k3Snapshot = k3Body?.prompt_composition ?? null;
  const crossModel = k3Snapshot?.schema_version === 3
    && k3Snapshot?.target_model_id === "fake-sd15-alt"
    && k3Snapshot?.applied?.positive_prompt === PROMPT_A
    && k3Snapshot?.applied?.result_id === "cmp-ucp08-0001";
  check("UCP08 · K3 모델 변경 후 다른 모델 적용 기록 없음", false, crossModel);
  check("UCP08 · K3 최종 프롬프트는 사용자 작업으로 유지", PROMPT_A, k3Body?.prompt ?? null);
  record("UCP08 K3 모델 전환", JSON.stringify({ submitted: k3Body !== null,
    schema: k3Snapshot?.schema_version ?? null,
    target: k3Snapshot?.target_model_id ?? null,
    applied: k3Snapshot?.applied?.positive_prompt ?? null }));
  await select(".composer select", "fake-sd15");
  await sleep(600);

  // ── L. 모델 변경 후 후보 만료 ──────────────────────────────────────────────────
  await clickByText(".compose-candidate .compose-apply", "이 프롬프트 사용").catch(() => false);
  await sleep(450);
  await select(".composer select", "fake-flux2");
  await sleep(800);
  const switched = await evaluate(SNAPSHOT);
  // The target change turns the session into `failed/expired`, so the explanation is the
  // failure alert for that category and the candidate list is gone — there is no stale
  // notice, because there is no draft left to call stale.
  //
  // The title comes from `FAILURE_COPY`, but the body is the session's own override
  // (`invalidateForTarget` says "이전 후보를", the generic copy says "이 결과를"), because
  // `failureAlert` prefers a caller-supplied message. Asserting the generic string here
  // would demand the panel discard the more specific sentence it was given.
  const expireCopy = failureAlert("expired", null);
  check("UCP08 · 모델 변경 후 만료 경고", true,
    switched.alerts.some((alert) => alert.title === expireCopy.title));
  check("UCP08 · 만료 경고가 원인을 말함", true,
    switched.alerts.some((alert) => alert.message.includes("모델")
      && alert.message.includes("다시 생성")));
  check("UCP08 · 모델 변경 후 후보 사라짐", 0, switched.candidates.length);
  check("UCP08 · 모델 변경 후 원문 보존", true, switched.brief.startsWith(FREE_TEXT));
  record("UCP08 모델 변경", JSON.stringify({ alerts: switched.alerts,
    candidates: switched.candidates.length, brief: switched.brief }));

  // ── M. 실패와 취소 후 편집 상태 보존 ───────────────────────────────────────────
  await select(".composer select", "fake-sd15");
  await sleep(600);
  await evaluate(`window.__composeMode = "unavailable";`);
  await click(".compose-generate");
  await waitFor(`document.querySelectorAll('.compose-alert').length > 0`,
    { label: "failure alert", timeout: 20000 });
  await sleep(250);
  const failed = await evaluate(SNAPSHOT);
  const providerCopy = failureAlert("provider_error", null);
  check("UCP08 · 실패 시 경고 표시", true, failed.alerts.length > 0);
  // The panel renders its own Korean copy, never the server's diagnostic `message`
  // (`failureFromBody` discards it on purpose), so the assertion is against that source.
  check("UCP08 · 실패 경고가 원인을 말함", true,
    (failed.alerts[0]?.title ?? "") === providerCopy.title
    && (failed.alerts[0]?.message ?? "").includes(providerCopy.message));
  check("UCP08 · 실패 후에도 원문 보존", true, failed.brief.startsWith(FREE_TEXT));
  check("UCP08 · 실패 후에도 칩 보존", true, failed.chips.length > 0);
  check("UCP08 · 실패 후 다시 시도 버튼", true, await evaluate(
    `[...document.querySelectorAll('.compose-actions button')]
      .some((b) => b.textContent.includes('다시 시도'))`));
  record("UCP08 실패", JSON.stringify({ alerts: failed.alerts, brief: failed.brief,
    chips: failed.chips.length }));

  // Cancel: a held reply is aborted and the edit survives. This is also where 중복 요청
  // 차단 is provable, because the button is disabled while `pending`.
  await evaluate(`window.__composeMode = "slow";`);
  await click(".compose-generate");
  await sleep(600);
  const pendingView = await evaluate(`(() => ({
    label: document.querySelector('.compose-generate').textContent.trim(),
    disabled: document.querySelector('.compose-generate').disabled,
    cancel: [...document.querySelectorAll('.compose-actions button')]
      .some((b) => b.textContent.trim() === '취소'),
    chips: document.querySelectorAll('.compose-chip').length,
  }))()`);
  check("UCP08 · 요청 중 생성 버튼이 대기 표시", true,
    pendingView.label.includes("생성 중"));
  check("UCP08 · 요청 중 중복 요청 차단", true, pendingView.disabled);
  check("UCP08 · 요청 중 취소 버튼", true, pendingView.cancel);
  check("UCP08 · 요청 중에도 칩 보존", true, pendingView.chips > 0);

  await evaluate(`window.__composeMode = "ready";`);
  await clickByText(".compose-actions button", "취소");
  await sleep(700);
  const cancelledRun = await evaluate(SNAPSHOT);
  check("UCP08 · 취소 후 원문 보존", true, cancelledRun.brief.startsWith(FREE_TEXT));
  check("UCP08 · 취소 후 칩 보존", true, cancelledRun.chips.length > 0);
  check("UCP08 · 취소 안내 문구", true, (cancelledRun.status ?? "").includes("취소"));
  check("UCP08 · 취소 후 재시도 가능", true, await evaluate(
    `[...document.querySelectorAll('.compose-actions button')]
      .some((b) => b.textContent.includes('다시 시도'))`));
  record("UCP08 취소", JSON.stringify({ status: cancelledRun.status,
    brief: cancelledRun.brief, chips: cancelledRun.chips.length }));
  await shot(shots, "23-compose-failure.png");

  // ── N. 확인 필요 상태: applying stays blocked until an answer is sent ─────────
  await evaluate(`window.__composeMode = "clarify";`);
  await click(".compose-generate");
  await waitFor(`!!document.querySelector('.compose-clarify')`,
    { label: "clarification", timeout: 20000 });
  const clarify = await evaluate(SNAPSHOT);
  check("UCP08 · 확인 필요 섹션 표시", 2, clarify.clarify.length);
  check("UCP08 · 확인 중에는 후보 없음", 0, clarify.candidates.length);
  check("UCP08 · 확인 중 적용 버튼 없음", 0,
    await evaluate(`document.querySelectorAll('.compose-apply').length`));

  await evaluate(`window.__composeMode = "ready";`);
  await clickByText(".compose-question button", "여성");
  await waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "candidates after answer", timeout: 20000 });
  await sleep(300);
  const answered = await evaluate(SNAPSHOT);
  const answerBody = await evaluate(
    `window.__composeCalls[window.__composeCalls.length - 1]`);
  check("UCP08 · 답변 후 후보 표시", 3, answered.candidates.length);
  check("UCP08 · 답변이 요청에 전달", true,
    (answerBody?.clarification_choices ?? []).length > 0);
  check("UCP08 · 답변이 원문과 칩을 지우지 않음", EDITED_TEXT, answerBody?.brief_ko);
  record("UCP08 확인", JSON.stringify({ options: clarify.clarify,
    answered: answered.candidates.length,
    choices: answerBody?.clarification_choices }));

  // ── O. 알 수 없는 모델 계열은 폴백을 보여주고 후보를 만들지 않는다 ─────────────
  await select(".composer select", "fake-unknown");
  await sleep(800);
  const unknownFamily = await evaluate(`(() => ({
    fallback: document.querySelector('.compose-fallback')?.textContent?.trim() ?? null,
    disabled: document.querySelector('.compose-generate')?.disabled ?? null,
    candidates: document.querySelectorAll('.compose-candidate').length,
    brief: document.querySelector('#compose-brief')?.value ?? null,
  }))()`);
  check("UCP08 · 미지원 계열은 폴백 안내", true,
    (unknownFamily.fallback ?? "").includes("출력 프로필"));
  check("UCP08 · 미지원 계열은 생성 비활성", true, unknownFamily.disabled);
  check("UCP08 · 미지원 계열은 후보 없음", 0, unknownFamily.candidates);
  check("UCP08 · 미지원 계열도 원문 보존", true,
    (unknownFamily.brief ?? "").startsWith(FREE_TEXT));
  record("UCP08 미지원 계열", JSON.stringify(unknownFamily));

  // ── P. 키보드 도달성: Tab reaches the panel's controls, in DOM order ───────────
  await select(".composer select", "fake-sd15");
  await sleep(600);
  await evaluate(`document.querySelector('#compose-brief').focus()`);
  const tabStops = [];
  for (let index = 0; index < 6; index += 1) {
    await press("Tab", "Tab", 9);
    tabStops.push(await evaluate(`(() => {
      const node = document.activeElement;
      if (!node) return null;
      return { tag: node.tagName, id: node.id || null,
        text: (node.textContent || '').trim().slice(0, 24),
        inCompose: !!node.closest('.compose') };
    })()`));
  }
  check("UCP08 · Tab이 구성기 안에 머무름", true,
    tabStops.filter((stop) => stop?.inCompose).length >= 3);
  check("UCP08 · Tab 순회가 실제 키 이벤트로 이동", true,
    new Set(tabStops.map((stop) => `${stop?.tag}:${stop?.id}:${stop?.text}`)).size > 1);
  record("UCP08 Tab 순회", JSON.stringify(tabStops));

  // ── Q. 반응형: 가로 넘침과 터치 크기 (emulation = layout only, not a device) ──
  await evaluate(`window.__composeMode = "ready";`);
  await click(".compose-generate");
  await waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "candidates for responsive", timeout: 20000 });
  for (const [width, height, mobile] of [[360, 800, true], [390, 844, true],
    [430, 932, true], [768, 1024, false], [1280, 900, false], [1440, 900, false]]) {
    await page.viewport(width, height, mobile);
    await sleep(450);
    const layout = await evaluate(`(() => {
      const box = (node) => node ? (() => { const r = node.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null;
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        apply: box(document.querySelector('.compose-apply')),
        chipButton: box(document.querySelector('.compose-chip button')),
        briefFont: getComputedStyle(document.querySelector('#compose-brief')).fontSize,
        candidateRight: box(document.querySelector('.compose-candidate')),
        columns: getComputedStyle(document.querySelector('.compose'))
          .gridTemplateColumns,
      };
    })()`);
    check(`UCP08 · ${width}px 가로 넘침 없음`, true, layout.overflow <= 1);
    check(`UCP08 · ${width}px 적용 버튼 44px 이상`, true,
      layout.apply !== null && layout.apply.h >= 44);
    check(`UCP08 · ${width}px 칩 버튼 44px 이상`, true,
      layout.chipButton !== null && layout.chipButton.h >= 44);
    check(`UCP08 · ${width}px 입력 글자 16px 이상`, true,
      parseFloat(layout.briefFont) >= 16);
    record(`UCP08 ${width}px`, JSON.stringify(layout));
    await shot(shots, `24-${width}.png`);
  }
  await page.viewport(1280, 900, false);
  await sleep(300);

  // ── R. 회전/resize는 다시 그릴 뿐 재요청하지 않는다 ───────────────────────────
  const beforeRotate = await evaluate(SNAPSHOT);
  const callsBeforeRotate = await evaluate(`window.__composeCalls.length`);
  await page.viewport(844, 390, true);
  await sleep(450);
  const landscapeOverflow = await evaluate(
    `document.documentElement.scrollWidth - innerWidth`);
  await page.viewport(1280, 900, false);
  await sleep(450);
  const afterRotate = await evaluate(SNAPSHOT);
  check("UCP08 · 가로 화면에서도 넘침 없음", true, landscapeOverflow <= 1);
  check("UCP08 · 회전 후 원문 보존", beforeRotate.brief, afterRotate.brief);
  check("UCP08 · 회전 후 칩 보존", beforeRotate.chips.length, afterRotate.chips.length);
  check("UCP08 · 회전 후 후보 보존", beforeRotate.candidates.length,
    afterRotate.candidates.length);
  check("UCP08 · 회전이 재요청을 만들지 않음", callsBeforeRotate,
    await evaluate(`window.__composeCalls.length`));

  // ── S. 장문 후보: 긴 본문·긴 제목이 잘리지 않고 넘치지도 않는다 ────────────────
  await evaluate(`(() => {
    window.__composeReply = ${JSON.stringify(readyReply({
      summary_ko: "아주 긴 요약 ".repeat(30),
      candidates: [
        { candidate_id: "long-1", title_ko: "아주 긴 제목 ".repeat(8),
          difference_ko: "긴 차이 설명 ".repeat(20),
          positive_prompt: "a very long english prompt, ".repeat(45),
          negative_prompt: "long negative, ".repeat(30),
          preserved_ko: ["보존 ".repeat(20)] },
      ],
    }))};
    return true;
  })()`);
  await page.viewport(360, 800, true);
  await sleep(300);
  await click(".compose-generate");
  await waitFor(`document.querySelectorAll('.compose-candidate').length === 1`,
    { label: "long candidate", timeout: 20000 });
  await sleep(350);
  const longBody = await evaluate(`(() => {
    const prompt = document.querySelector('.compose-candidate__prompt');
    const apply = document.querySelector('.compose-apply');
    return {
      textLength: prompt.textContent.length,
      clipped: prompt.scrollWidth > prompt.clientWidth + 1,
      applyVisible: apply.getBoundingClientRect().height > 0,
      overflow: document.documentElement.scrollWidth - innerWidth,
      promptHeight: Math.round(prompt.getBoundingClientRect().height),
    };
  })()`);
  check("UCP08 · 장문 후보 본문 전부 보존", true, longBody.textLength > 1000);
  check("UCP08 · 장문 후보 가로 잘림 없음", false, longBody.clipped);
  check("UCP08 · 장문 후보에서도 적용 버튼 보임", true, longBody.applyVisible);
  check("UCP08 · 장문 후보에서도 가로 넘침 없음", true, longBody.overflow <= 1);
  record("UCP08 장문", JSON.stringify(longBody));
  await shot(shots, "25-long-candidate.png");
  await page.viewport(1280, 900, false);
  await sleep(300);

  // ── T. 저장·복원: 적용한 스냅샷이 실제 v3 요청으로 나가고 되읽힌다 ────────────
  // A hand-picked chip that the reply does not mention, so "manual survives the reply and
  // reaches storage" is exercised rather than assumed. Earlier blocks hand their manual chip
  // back to the AI (§F), which is why this needs its own pick.
  await typeInto("#compose-dictionary input[type=search]", "차분한");
  await sleep(250);
  const manualForStorage = await evaluate(`(() => {
    const option = [...document.querySelectorAll('.compose-option')]
      .find((node) => (node.textContent || '').includes('차분한 분위기'));
    if (!option) return null;
    option.click();
    return option.querySelector('span')?.textContent ?? null;
  })()`);
  await sleep(300);
  check("UCP08 · 저장 전 수동 선택 추가", "차분한 분위기", manualForStorage);

  await evaluate(`window.__composeReply = ${JSON.stringify(readyReply())};`);
  await click(".compose-generate");
  await waitFor(`document.querySelectorAll('.compose-candidate').length === 3`,
    { label: "candidates for storage", timeout: 20000 });
  await sleep(300);
  const chipForStorage = await evaluate(`(() => {
    const chip = [...document.querySelectorAll('.compose-chip')]
      .find((node) => node.getAttribute('data-source') === 'manual');
    return chip ? { label: chip.querySelector('.compose-chip__label')?.textContent ?? null,
      badges: [...chip.querySelectorAll('.compose-chip__badge')].map((b) => b.textContent) }
      : null;
  })()`);
  check("UCP08 · 응답 후에도 수동 칩이 남음", "차분한 분위기", chipForStorage?.label);
  check("UCP08 · 수동 칩에 '직접' 배지", true,
    (chipForStorage?.badges ?? []).includes("직접"));
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".compose-candidate .compose-apply", "이 프롬프트 사용");
  await sleep(450);
  const beforeSubmit = await evaluate(SNAPSHOT);
  check("UCP08 · 저장 전 최종 프롬프트가 후보 값", PROMPT_A, beforeSubmit.finalPrompt);

  // Capture the body the app itself sends, so "which snapshot version" is a fact, not a
  // guess about what the UI would have built.
  await evaluate(`(() => {
    window.__jobBodies = [];
    const real = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/v1/jobs') && init && init.method === 'POST') {
        try { window.__jobBodies.push(JSON.parse(init.body)); } catch (error) { /* ignore */ }
      }
      return real(input, init);
    };
    return true;
  })()`);
  await click("button.generate");
  const stored = await waitFor(api(`
    const jobs = await (await fetch('/api/v1/jobs?limit=5', { headers })).json();
    const job = jobs.find((item) => item.status === 'completed'
      && item.prompt_composition?.schema_version === 3);
    return job ? { jobId: job.job_id, assetId: job.output_asset_ids?.[0] ?? null } : false;
  `), { label: "v3 job completed", timeout: 45000 });
  check("UCP08 · v3 작업이 완료되고 자산을 남김", true, Boolean(stored?.assetId));
  record("UCP08 v3 작업", JSON.stringify(stored));

  const jobBody = await evaluate(`window.__jobBodies[window.__jobBodies.length - 1] ?? null`);
  const snapshot = jobBody?.prompt_composition ?? null;
  check("UCP08 · 이미지 생성 본문이 v3 스냅샷", 3, snapshot?.schema_version ?? null);
  check("UCP08 · 생성 본문 prompt가 적용 값", PROMPT_A, jobBody?.prompt);
  check("UCP08 · 스냅샷이 실제 적용 문자열을 기록", PROMPT_A,
    snapshot?.applied?.positive_prompt);
  check("UCP08 · 스냅샷이 수동 선택을 보존", true,
    (snapshot?.selections ?? []).some((item) => item.source === "manual"));
  check("UCP08 · 스냅샷이 장면 귀속을 보존", true,
    (snapshot?.selections ?? []).some((item) => item.entity_id));
  record("UCP08 v3 본문", JSON.stringify({
    schema: snapshot?.schema_version,
    applied: snapshot?.applied?.positive_prompt,
    selections: snapshot?.selections?.length,
    trim: snapshot?.snapshot_trim,
    bytes: JSON.stringify(snapshot ?? {}).length,
  }));

  const readBack = await evaluate(api(`
    const [metadata, events] = await Promise.all([
      fetch('/api/v1/assets/${stored.assetId}/metadata', { headers }),
      fetch('/api/v1/jobs/${stored.jobId}/events', { headers }),
    ]);
    const meta = await metadata.json();
    const stream = await events.text();
    const composition = meta.prompt_composition ?? {};
    // The stream is SSE, one frame per event, with the job record as JSON on a \`data:\` line.
    // Parsing beats a substring test: the payload's spacing is the server's choice, so
    // \`"schema_version":3\` would break on a \`json.dumps\` that added a space.
    const payloads = stream.split('\\n\\n')
      .map((frame) => frame.split('\\n').filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim()).join(''))
      .filter((data) => data.length > 0)
      .map((data) => { try { return JSON.parse(data); } catch { return null; } })
      .filter((value) => value !== null);
    const withSnapshot = payloads.filter((payload) =>
      payload.prompt_composition && typeof payload.prompt_composition === 'object');
    return { status: metadata.status, schema: composition.schema_version ?? null,
      applied: composition.applied?.positive_prompt ?? null,
      prompt: meta.prompt ?? null,
      selections: (composition.selections ?? []).map((item) => item.source),
      environment: composition.scene?.environment ?? null,
      eventCount: payloads.length,
      eventSchemas: [...new Set(withSnapshot.map((p) => p.prompt_composition.schema_version ?? null))],
      eventPrompt: withSnapshot.at(-1)?.prompt ?? null };
  `));
  check("UCP08 · 되읽은 기록이 v3", 3, readBack.schema);
  check("UCP08 · 되읽은 applied가 제출 값", PROMPT_A, readBack.applied);
  check("UCP08 · 되읽은 prompt가 제출 값", PROMPT_A, readBack.prompt);
  check("UCP08 · 되읽은 선택 출처에 manual 존재", true,
    (readBack.selections ?? []).includes("manual"));
  // Every event that carries a snapshot carries a v3 one — the check the substring version
  // was trying to make, now made against parsed payloads.
  check("UCP08 · events 스트림의 스냅샷이 v3", JSON.stringify([3]),
    JSON.stringify(readBack.eventSchemas));
  check("UCP08 · events 스트림의 prompt가 제출 값", PROMPT_A, readBack.eventPrompt);
  check("UCP08 · events 스트림이 비어 있지 않음", true, readBack.eventCount > 0);
  check("UCP08 · 저장된 environment에 null 키 없음", true,
    readBack.environment === null
      || Object.values(readBack.environment ?? {}).every((value) => value !== null));
  record("UCP08 되읽기", JSON.stringify(readBack));
  await shot(shots, "26-compose-stored.png");

  // ── U. 갤러리 복원: 실제 이미지 카드에서 v3 기록을 다시 불러온다 ───────────────
  // Reading the row through the API proves storage; it does not prove the *screen* can
  // restore it. This drives the gallery modal a user would open, twice — once before a
  // reload and once after, because the second one is what shows the restore comes from the
  // row and not from React state left over from the submit.
  const assetPrefix = stored.assetId.slice(0, 8);
  const restoreFromGallery = async (label) => {
    await clickByText(".jobs-actions button", "새로고침").catch(() => false);
    await waitFor(`(() => [...document.querySelectorAll('.asset')]
      .some((node) => (node.textContent || '').includes(${JSON.stringify(assetPrefix)})))()`,
      { label: `asset in gallery (${label})`, timeout: 25000 });
    const opened = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.asset')]
        .find((node) => (node.textContent || '').includes(${JSON.stringify(assetPrefix)}));
      const button = card && [...card.querySelectorAll('button')]
        .find((node) => node.textContent.trim() === '정보');
      if (button) button.click();
      return !!button;
    })()`);
    if (!opened) throw new Error(`정보 button not found for asset ${assetPrefix}`);
    await waitFor(`!!document.querySelector('.modal')`, { label: `modal (${label})` });
    const modal = await evaluate(`(() => {
      const text = document.querySelector('.modal')?.textContent ?? '';
      return { hasRestore: [...document.querySelectorAll('.modal button')]
        .some((node) => node.textContent.includes('이 설정으로 다시 생성')),
        v3: /스키마 v3/.test(text) };
    })()`);
    await clickByText(".modal button", "이 설정으로 다시 생성");
    await sleep(700);
    const restored = await evaluate(`(() => ({
      finalPrompt: document.querySelector('.composer textarea[rows="5"]')?.value ?? null,
      negative: document.querySelector('.composer textarea[rows="2"]')?.value ?? null,
      model: document.querySelector('.composer select')?.value ?? null,
      notice: document.querySelector('.prompt-notice')?.textContent?.trim() ?? null,
    }))()`);
    return { ...restored, modal };
  };

  const firstRestore = await restoreFromGallery("before reload");
  check("UCP08 · 갤러리에서 v3 복원 경로 존재", true, firstRestore !== null);
  // The modal reads the row itself, so a v3 record is offered as a restore rather than
  // presented as a legacy/opaque composition.
  check("UCP08 · 정보 창이 v3로 표시", true, firstRestore.modal.v3);
  check("UCP08 · 정보 창에 복원 버튼", true, firstRestore.modal.hasRestore);
  // The restored prompt is the *applied* string from the record, which is the whole point of
  // storing `applied` separately from `brief_ko`.
  check("UCP08 · 복원이 적용 문자열을 되살림", PROMPT_A, firstRestore.finalPrompt);
  check("UCP08 · 복원이 negative도 되살림", "blurry, text", firstRestore.negative);
  check("UCP08 · 복원이 모델을 기록에서 고름", "fake-sd15", firstRestore.model);
  // A complete v3 record supplies everything, so the panel must not warn about gaps.
  check("UCP08 · 완전한 v3 복원에는 누락 안내 없음", null, firstRestore.notice);
  record("UCP08 갤러리 복원", JSON.stringify(firstRestore));
  await shot(shots, "27-compose-restored.png");

  // Finally: reload and restore again. Nothing of the compose session survives a reload, so
  // a successful second restore can only come from the stored row.
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.prompt-builder > .quiet')`,
    { label: "reload before second restore", timeout: 20000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "models after reload", timeout: 20000 });
  await sleep(600);
  const secondRestore = await restoreFromGallery("after reload");
  check("UCP08 · 새로고침 후에도 복원이 동작", PROMPT_A, secondRestore.finalPrompt);
  check("UCP08 · 새로고침 후 복원된 프롬프트가 동일", firstRestore.finalPrompt,
    secondRestore.finalPrompt);
  check("UCP08 · 새로고침 후 negative가 동일", firstRestore.negative, secondRestore.negative);
  record("UCP08 재시작 복원", JSON.stringify(secondRestore));

  // The restored prompt is real, so the image form accepts it and can submit.
  const canResubmit = await evaluate(`(() => {
    const button = document.querySelector('button.generate');
    return { disabled: button?.disabled ?? null };
  })()`);
  check("UCP08 · 복원된 프롬프트로 재생성 가능", false, canResubmit.disabled);
  await shot(shots, "28-compose-restored-reload.png");

  // ── V. 결정적 API 응답으로 32 KiB 거부와 snapshot_trim 안내를 화면에서 확인 ──────
  // Two paths the UI cannot reach on its own, and therefore the two that were left
  // unverified. Both are *server answers*, so both are driven by a stubbed response rather
  // than by contriving a UI state:
  //
  //   1. **413 on save.** The trim ladder always lowers a payload first, so the only way the
  //      save route rejects for size is when the ladder cannot get under 32 KiB — and this
  //      client refuses to build such a body (its own caps are smaller). Pinning the
  //      *client's* handling of a deterministic 413 is still worth doing: it is the path
  //      that decides whether a rejected save is reported or swallowed.
  //   2. **`snapshot_trim` in the modal.** A trimmed row can only be produced by the
  //      server's ladder, so the read path is exercised with a stored row that says it was
  //      trimmed, exactly as a real trimmed row would.
  //
  // Neither substitutes for running the real ladder against a real server. That is what the
  // backend tests do, and block T above is what proves a *real* save/read round trip works.
  // These prove the client reports both facts instead of dropping them.

  /** Installs a one-shot response for a URL predicate, then restores the previous fetch. */
  const stubOnce = async (predicate, status, body) => evaluate(`(() => {
    const real = window.fetch;
    let used = false;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!used && (${predicate})(url, init)) {
        used = true;
        window.fetch = real;
        return new Response(JSON.stringify(${JSON.stringify(body)}), {
          status: ${status}, headers: { 'Content-Type': 'application/json' } });
      }
      return real(input, init);
    };
    return true;
  })()`);

  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.prompt-builder > .quiet')`,
    { label: "reload before block V", timeout: 20000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "models after reload for V", timeout: 20000 });
  await sleep(500);

  // A prompt long enough to be a real v3 submission, built through the UI's own path.
  await evaluate(setValue('.composer textarea[rows="5"]', "결과 이미지 재사용 검증용 프롬프트"));
  await sleep(200);
  await evaluate(`(() => {
    const close = document.querySelector('.errorbox button');
    if (close) close.click();
    return true;
  })()`);

  // 1. The save route answers 413. The user must see which cap was hit, not a silent no-op.
  //
  // The predicate must name the method, like the other stubs in this file do: the queue polls
  // `GET /api/v1/jobs?limit=…` every 4 s, and a URL-only match lets a poll consume the one-shot
  // stub. The 413 would then be spent on a list read, the real POST would succeed, and the
  // check would fail for a reason that has nothing to do with the client's error handling.
  await stubOnce(`(url, init) => url.includes('/api/v1/jobs') && init && init.method === 'POST'`,
    413, { detail: "Prompt composition exceeds 32 KiB and could not be trimmed" });
  await click("button.generate").catch(() => false);
  await sleep(700);
  const after413 = await evaluate(`(() => {
    const box = document.querySelector('.errorbox');
    return { text: box?.textContent?.trim() ?? null,
      visible: !!box && box.getBoundingClientRect().height > 0 };
  })()`);
  // The exact server sentence is surfaced. Asserting the wording of the *client's* own copy
  // would not prove the server's reason reached the screen, which is the point.
  check("UCP08 · 413 저장 거부가 화면에 표시됨", true, after413.visible);
  check("UCP08 · 413 응답의 사유가 그대로 노출", true,
    (after413.text ?? "").includes("32 KiB"));
  record("UCP08 413 처리", JSON.stringify(after413));
  await shot(shots, "29-save-413.png");

  // 2. A stored row that says it was trimmed. The modal must name the loss rather than
  //    render the surviving fields as if they were the whole record.
  const trimmedRow = {
    schema_version: 3,
    compiler_version: "1.3.0",
    dictionary_version: "1.2.0",
    target_model_id: "fake-sd15",
    target_family: "sd15",
    profile_version: 2,
    brief_ko: "잘린 기록",
    selections: [{ id: "lighting.neon", source: "manual", pinned: false }],
    scene: { entities: [], relations: [], environment: {},
      unmapped_details: [], ambiguities: [] },
    applied: { result_id: "res-trim", candidate_id: "cand-a",
      provider_model: "stub-compose", applied_at: "2026-11-23T00:00:00Z",
      positive_prompt: PROMPT_A, summary_ko: "요약" },
    snapshot_trim: ["evidence_ko", "brief_2000"],
  };
  await stubOnce(`(url) => url.includes('/metadata')`, 200, {
    model_id: "fake-sd15", prompt: PROMPT_A, negative_prompt: "",
    width: 512, height: 512, steps: 4, cfg_scale: 1.0, seed: 1,
    preset: "balanced", sampling_method: null, scheduler: null,
    prompt_composition: trimmedRow,
  });
  // Reopen a gallery card the same way block U does, so the stubbed metadata answer is the
  // one the modal renders.
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.asset')]
      .map((card) => [...card.querySelectorAll('button')]
        .find((node) => node.textContent.trim() === '정보'))
      .find(Boolean);
    if (button) button.click();
    return !!button;
  })()`);
  await sleep(800);
  const trimNotice = await evaluate(`(() => {
    const modal = document.querySelector('.modal');
    const notice = [...(modal?.querySelectorAll('p') ?? [])]
      .map((node) => node.textContent ?? '')
      .find((line) => line.includes('저장 시 축소됨')) ?? null;
    return { open: !!modal, notice };
  })()`);
  check("UCP08 · 축소된 기록의 정보 창이 열림", true, trimNotice.open);
  // Both step names must be named: a notice saying only "축소됨" would not tell the user
  // *what* is gone, which is the only actionable part.
  check("UCP08 · 축소 안내가 단계 이름을 포함", true,
    (trimNotice.notice ?? "").includes("evidence_ko")
    && (trimNotice.notice ?? "").includes("brief_2000"));
  record("UCP08 snapshot_trim 안내", JSON.stringify(trimNotice.notice));
  await shot(shots, "30-snapshot-trim-notice.png");
  await evaluate(`(() => {
    const close = document.querySelector('.modal .close');
    if (close) close.click();
    return true;
  })()`);
}
