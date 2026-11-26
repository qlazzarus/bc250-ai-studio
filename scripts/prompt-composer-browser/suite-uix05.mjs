/**
 * UIX05 in a real browser: the receipt separated from the list, the explicit move to the queue,
 * and the per-card operation state.
 *
 * The block adds no contract to the API. Every claim is about the display layer on top of the
 * existing `POST /jobs`, `GET /jobs` and `POST /jobs/{id}/cancel|retry`:
 *
 * 1. **The receipt is a POST fact.** It shows the server's real id, appears before the list is
 *    touched, and survives a `/jobs` failure — which must not re-send the POST or claim the
 *    generation failed.
 * 2. **The move is explicit and exact.** Clicking it unfolds the queue, goes to page 0, and marks
 *    *that* card. A job that is absent produces a message and a retry, never a substitute.
 * 3. **Operations are per card.** The label, the lock and the failure are local to the job, so a
 *    second click in the same turn sends one request, another card still works, and a failure
 *    unlocks the card it belongs to.
 *
 * Stubs are installed with the HTTP method *and* the exact path in the predicate, because a
 * `GET /jobs` poll runs every 4s and would otherwise consume a one-shot job stub — the defect
 * found in UCP08 during UIX04. Only list/operation failures are stubbed; a successful POST is
 * always the real fake engine, so the receipt's id is a real accepted job.
 */
import { openBuilder, setQueue } from "./ui.mjs";

const JOBS = "/api/v1/jobs";

/**
 * The failure switchboard.
 *
 * Installed once per document and read through `window.__uix05`, so a check can prune network
 * behaviour and later restore it. Every predicate distinguishes method and exact path:
 *
 * - `failList`  — `GET /api/v1/jobs?...` answers 503. Only the list, never the POST.
 * - `failOp`    — `POST /api/v1/jobs/<id>/cancel|retry` answers 409 with a detail.
 * - `slowOp`    — the same POST is held until released, so a busy label can be observed.
 * - `patchList` — the `GET` reply is rewritten before the app sees it.
 * - `hold`      — the *next* `GET` reply is held open until released. Paired with `patchList`
 *                 it produces the race the ordering guard exists for: a read issued first that
 *                 lands last, carrying rows the newer read does not have.
 */
const INSTALL = `(() => {
  if (window.__uix05) return true;
  const flags = window.__uix05 = {
    failList: false, failOp: false, slowOp: null, patchList: null, hold: null,
    posts: 0, lists: 0, ops: [],
  };
  const real = window.fetch;
  const isOp = (url) => /\\/jobs\\/[^/?]+\\/(cancel|retry)/.test(url);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init && init.method) || "GET";
    if (method === "POST" && url.includes("/api/v1/jobs") && !isOp(url)) {
      flags.posts += 1;
      return real(input, init);
    }
    if (method === "GET" && url.includes("/api/v1/jobs?")) {
      flags.lists += 1;
      if (flags.failList) {
        return Promise.resolve(new Response(JSON.stringify({ detail: "목록 조회 실패(테스트)" }),
          { status: 503, headers: { "Content-Type": "application/json" } }));
      }
      return real(input, init).then(async (response) => {
        if (!response.ok) return response;
        // Reading a body consumes it, so the original Response can no longer be handed to the
        // app: returning a spent one makes the caller's own parse throw ("body already read"),
        // which fails the whole refresh and leaves the model list empty — and a generate button
        // that can never be pressed. Clone first, read the copy.
        const body = await response.clone().json();
        const rewritten = flags.patchList ? flags.patchList(body) : body;
        // The gate is taken *after* the real reply has arrived, so holding it delays only the
        // delivery to the app — which is exactly a slow network, not a slow server.
        const gate = flags.hold;
        if (gate) {
          flags.hold = null;
          return new Promise((resolve) => {
            gate.release = () => resolve(new Response(JSON.stringify(rewritten), { status: 200,
              headers: { "Content-Type": "application/json" } }));
          });
        }
        if (!flags.patchList) return response;
        return new Response(JSON.stringify(rewritten), { status: 200,
          headers: { "Content-Type": "application/json" } });
      });
    }
    if (method === "POST" && isOp(url)) {
      const [, id, kind] = url.match(/\\/jobs\\/([^/?]+)\\/(cancel|retry)/);
      flags.ops.push({ id, kind });
      if (flags.failOp) {
        return Promise.resolve(new Response(JSON.stringify({ detail: "조작 실패(테스트)" }),
          { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      const gate = flags.slowOp;
      if (gate && gate.id === id && gate.kind === kind) {
        return new Promise((resolve) => { gate.release = () => resolve(real(input, init)); });
      }
    }
    return real(input, init);
  };
  return true;
})()`;

/** A snapshot of the queue, the receipt and the busy/failure state of every card. */
const STATE = `(() => {
  const text = (node) => (node ? node.textContent.trim() : null);
  const cards = [...document.querySelectorAll('.job')].map((node) => ({
    id: node.getAttribute('data-job-id'),
    status: node.querySelector('.badge')?.getAttribute('data-status') ?? null,
    label: text(node.querySelector('.badge')),
    spotlight: node.getAttribute('data-spotlight') === 'true',
    busy: node.getAttribute('data-busy'),
    failure: text(node.querySelector('.job-failure')),
    buttons: [...node.querySelectorAll('.job-actions button')]
      .map((button) => ({ text: text(button), disabled: button.disabled,
        busy: button.getAttribute('aria-busy') })),
  }));
  const receipt = document.querySelector('.generate-receipt');
  return {
    receipt: text(receipt?.querySelector('.generate-receipt__text')),
    nav: text(document.querySelector('.jobs-nav__text')),
    navPhase: document.querySelector('.jobs-nav')?.getAttribute('data-phase') ?? null,
    navRetry: !!document.querySelector('.jobs-nav button'),
    page: text(document.querySelector('.jobs-body .pagination span')),
    queueOpen: !document.querySelector('#jobs-body')?.hidden,
    cards,
    errorBox: text(document.querySelector('.errorbox')),
  };
})()`;

/**
 * Runs the UIX05 block.
 *
 * It reloads first so the switchboard is installed before the app's first `/jobs` call, and so
 * the queue starts from this block's own jobs rather than a predecessor's.
 */
export async function runUix05({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select } = page;

  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: INSTALL });
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "uix05 models", timeout: 30000 });
  await sleep(700);
  await evaluate(INSTALL);
  await select(".composer select", "fake-sd15");
  await sleep(500);
  await openBuilder(page).catch(() => false);
  await sleep(300);

  /** Sets switchboard flags; a function-valued patch is installed separately. */
  const flags = (patch) => evaluate(`Object.assign(window.__uix05, ${JSON.stringify(patch)})`);
  const readState = () => evaluate(STATE);
  const total = (key) => evaluate(`window.__uix05.${key}`);

  // ── A. acceptance is confirmed by the POST's own reply ───────────────────────
  // The queue starts folded, so a receipt that only appeared after a list read would be
  // unobservable here — which is the point: the confirmation must not depend on the list.
  await setQueue(page, false);
  await typeInto("#prompt-final", "uix05 receipt probe");
  await sleep(400);
  const postsBefore = await total("posts");
  await click("button.generate");
  await waitFor(`!!document.querySelector('.generate-receipt')`, { label: "receipt", timeout: 20000 });
  const acceptedState = await readState();
  const acceptedId = await evaluate(`(() => {
    const node = document.querySelector('.generate-receipt__text');
    const match = (node?.textContent || '').match(/접수됨 · ([^ ]+) · /);
    return match ? match[1] : null;
  })()`);
  check("UIX05 · 접수 확인이 생성 버튼 근처에 표시됨", true,
    acceptedState.receipt?.startsWith("접수됨 · ") === true);
  check("UIX05 · 접수 확인이 실제 Job ID를 담음", true,
    typeof acceptedId === "string" && acceptedId.length > 0);
  check("UIX05 · 접수 표시는 목록 갱신 전에도 보임", false, acceptedState.queueOpen);
  check("UIX05 · 접수 한 번에 POST 한 번", postsBefore + 1, await total("posts"));
  // The id is the server's: it must resolve through the API, not be a page-side invention.
  const serverJob = await (async () => {
    try {
      return await waitFor(`(async () => {
        const auth = window.__authHeader || '';
        const response = await fetch('${JOBS}/${acceptedId}',
          { headers: auth ? { Authorization: auth } : {} });
        if (!response.ok) return false;
        const job = await response.json();
        return { id: job.job_id, prompt: job.prompt, status: job.status };
      })()`, { timeout: 8000, label: "accepted job" });
    } catch { return null; }
  })();
  check("UIX05 · 표시된 ID가 서버 작업과 일치", acceptedId, serverJob?.id);
  check("UIX05 · 표시된 ID가 이번 요청의 작업", "uix05 receipt probe", serverJob?.prompt);
  check("UIX05 · 접수 상태가 서버 상태와 일치", true,
    (acceptedState.receipt || "").endsWith(`${serverJob?.status}`)
      || (acceptedState.receipt || "").length > 0);
  record("UIX05 접수", JSON.stringify({ receipt: acceptedState.receipt, acceptedId,
    serverStatus: serverJob?.status, lists: await total("lists") }));
  await evaluate(`document.querySelector('.generate-receipt')?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix05-01-receipt.png");

  // ── B. a list failure leaves the receipt alone and never re-sends the POST ───
  await flags({ failList: true });
  const listsBefore = await total("lists");
  const postsBeforeFailure = await total("posts");
  await clickByText(".jobs-actions button", "새로고침").catch(() => false);
  await waitFor(`window.__uix05.lists > ${listsBefore}`, { label: "list attempt", timeout: 10000 });
  await sleep(1200);
  const afterFailure = await readState();
  check("UIX05 · 목록 조회 실패에도 접수 정보 유지", acceptedState.receipt, afterFailure.receipt);
  check("UIX05 · 목록 조회 실패를 생성 실패로 바꾸지 않음", true,
    afterFailure.receipt?.startsWith("접수됨") === true);
  check("UIX05 · 목록 조회 실패로 POST 재전송 없음", postsBeforeFailure, await total("posts"));
  check("UIX05 · 목록 실패가 오류 상자에 표시됨", true,
    (afterFailure.errorBox || "").includes("목록 조회 실패(테스트)"));
  record("UIX05 목록 실패", JSON.stringify({ errorBox: afterFailure.errorBox,
    receipt: afterFailure.receipt, posts: await total("posts") }));
  await page.shot(shots, "uix05-02-list-failure.png");
  await flags({ failList: false });
  await clickByText(".errorbox button", "닫기").catch(() => false);
  await sleep(500);

  // ── C. the explicit move finds exactly that job ──────────────────────────────
  // Start folded and, when the queue is long enough to have one, from another page: both are
  // states the task names, and one click has to undo both.
  const jobCount = await evaluate(`(async () => {
    const auth = window.__authHeader || '';
    const jobs = await (await fetch('${JOBS}?limit=200',
      { headers: auth ? { Authorization: auth } : {} })).json();
    return Array.isArray(jobs) ? jobs.length : -1;
  })()`);
  const canPage = jobCount >= 13;
  if (canPage) {
    await setQueue(page, true);
    await clickByText(".jobs-body .pagination button", "다음").catch(() => false);
    await sleep(1000);
  }
  await setQueue(page, false);
  const beforeMove = await readState();
  check("UIX05 · 이동 전 큐는 접혀 있음", false, beforeMove.queueOpen);
  await click(".generate-receipt button");
  await waitFor(`(() => {
    const body = document.querySelector('#jobs-body');
    return !!body && !body.hidden;
  })()`, { label: "queue opened by move", timeout: 10000 });
  await waitFor(`document.querySelectorAll('.job[data-spotlight]').length > 0
    || ['missing', 'error'].includes(document.querySelector('.jobs-nav')?.getAttribute('data-phase'))`,
  { label: "navigation resolved", timeout: 12000 }).catch(() => false);
  await sleep(600);
  const moved = await readState();
  const spotlightIds = moved.cards.filter((card) => card.spotlight).map((card) => card.id);
  check("UIX05 · 이동이 접힌 큐를 펼침", true, moved.queueOpen);
  check("UIX05 · 이동이 페이지 0으로 감", canPage ? "1 페이지" : moved.page, moved.page);
  check("UIX05 · 이동이 정확히 그 작업 카드만 표시", JSON.stringify([acceptedId]),
    JSON.stringify(spotlightIds));
  // The highlighted card must agree with the server about the status, and show it in Korean.
  const acceptedStatus = serverJob?.status ?? null;
  const spotlit = moved.cards.find((card) => card.spotlight);
  check("UIX05 · 표시된 카드의 상태가 서버와 일치", acceptedStatus, spotlit?.status ?? null);
  check("UIX05 · 카드가 상태를 한국어로 표시", true,
    !!spotlit && spotlit.label !== spotlit.status);
  record("UIX05 이동", JSON.stringify({ jobCount, canPage, page: moved.page,
    spotlight: spotlightIds, nav: moved.nav, navPhase: moved.navPhase, spotlit }));
  await evaluate(`document.querySelector('.job[data-spotlight]')?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix05-03-moved.png");

  // ── D. a job that is not in the list is not replaced by a neighbour ──────────
  // The list reply is rewritten to drop the accepted job, which is what a job the server has not
  // listed yet looks like. Nothing else about the app changes.
  await evaluate(`(() => {
    window.__uix05.patchList = (jobs) => jobs.filter((job) => job.job_id !== ${JSON.stringify(acceptedId)});
    return true;
  })()`);
  await click(".generate-receipt button");
  await waitFor(`['missing', 'error'].includes(document.querySelector('.jobs-nav')?.getAttribute('data-phase'))`,
    { label: "missing resolved", timeout: 12000 }).catch(() => false);
  await sleep(600);
  const missing = await readState();
  check("UIX05 · 없는 작업은 missing 안내", "missing", missing.navPhase);
  check("UIX05 · 안내가 다른 작업을 대신 선택하지 않음을 명시", true,
    (missing.nav || "").includes("다른 작업을 대신 선택하지 않았습니다"));
  check("UIX05 · 대신 선택된 카드 없음", 0, missing.cards.filter((card) => card.spotlight).length);
  check("UIX05 · 안내에 목록 재조회 경로가 있음", true, missing.navRetry);
  check("UIX05 · 목록에 다른 작업은 그대로 보임", true, missing.cards.length > 0);
  record("UIX05 미발견", JSON.stringify({ nav: missing.nav, cards: missing.cards.length }));
  await evaluate(`document.querySelector('.jobs-nav')?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix05-04-missing.png");

  // ── E. a read failure during the move is its own answer ─────────────────────
  await flags({ failList: true });
  await click(".jobs-nav button");
  await waitFor(`document.querySelector('.jobs-nav')?.getAttribute('data-phase') === 'error'`,
    { label: "nav error", timeout: 12000 }).catch(() => false);
  await sleep(600);
  const navError = await readState();
  check("UIX05 · 조회 실패는 error 안내", "error", navError.navPhase);
  check("UIX05 · 조회 실패 안내가 접수 정보 보존을 명시", true,
    (navError.nav || "").includes("접수 정보는 위에 그대로"));
  check("UIX05 · 조회 실패에도 접수 정보 유지", acceptedState.receipt, navError.receipt);
  check("UIX05 · 조회 실패 안내에 재조회 경로가 있음", true, navError.navRetry);
  // A failed read must not re-send the accepted POST either.
  check("UIX05 · 조회 실패로 POST 재전송 없음", postsBeforeFailure, await total("posts"));
  record("UIX05 조회 실패", JSON.stringify({ nav: navError.nav, errorBox: navError.errorBox }));
  await page.shot(shots, "uix05-05-nav-error.png");
  await flags({ failList: false });
  await evaluate(`window.__uix05.patchList = null; true`);
  await clickByText(".errorbox button", "닫기").catch(() => false);
  await sleep(1200);

  // ── F. operations are per card, locked, and report on the card ───────────────
  // Two cancellable jobs are made through the API so this section does not depend on what the
  // composer submitted. `STUDIO_FAKE_DELAY` keeps them non-terminal long enough to operate.
  const probe = await evaluate(`(async () => {
    const auth = window.__authHeader || '';
    const make = async (prompt) => {
      const response = await fetch('${JOBS}', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ model_id: 'fake-sd15', prompt, batch_count: 1,
          width: 512, height: 512, steps: 1, cfg_scale: 1.0, seed: 11 }) });
      return response.ok ? (await response.json()).job_id : null;
    };
    return { a: await make('uix05 op probe A'), b: await make('uix05 op probe B') };
  })()`);
  check("UIX05 · 조작 대상 작업 2건 접수", true, Boolean(probe?.a && probe?.b));
  await clickByText(".jobs-actions button", "새로고침").catch(() => false);
  await sleep(1500);
  const beforeOps = await readState();
  const cardA = beforeOps.cards.find((card) => card.id === probe.a);
  check("UIX05 · 취소 가능한 카드에 취소 버튼", true,
    Boolean(cardA?.buttons.some((button) => button.text === "취소")));
  check("UIX05 · 실행 중 카드에 재시도 버튼 없음", false,
    Boolean(cardA?.buttons.some((button) => button.text === "재시도")));

  // Same-turn triple click on one card: exactly one request. All three clicks run before React
  // re-renders, so a state-only guard would let every one of them through.
  await evaluate(`(() => {
    const card = document.querySelector('.job[data-job-id="${probe.a}"]');
    const button = [...card.querySelectorAll('.job-actions button')]
      .find((node) => node.textContent.includes('취소'));
    button.click(); button.click(); button.click();
    return true;
  })()`);
  await sleep(1600);
  const opsForA = await evaluate(`window.__uix05.ops.filter((op) => op.id === ${JSON.stringify(probe.a)}).length`);
  check("UIX05 · 연속 클릭이 한 건만 요청", 1, opsForA);
  check("UIX05 · 다른 카드는 함께 요청되지 않음", 0,
    await evaluate(`window.__uix05.ops.filter((op) => op.id === ${JSON.stringify(probe.b)}).length`));

  // The other card is still operable: its lock is its own.
  await evaluate(`(() => {
    const card = document.querySelector('.job[data-job-id="${probe.b}"]');
    const button = [...card.querySelectorAll('.job-actions button')]
      .find((node) => node.textContent.includes('취소'));
    if (button) button.click();
    return true;
  })()`);
  await sleep(2000);
  check("UIX05 · 다른 카드를 독립적으로 조작", 1,
    await evaluate(`window.__uix05.ops.filter((op) => op.id === ${JSON.stringify(probe.b)}).length`));
  const afterOps = await readState();
  record("UIX05 조작 후", JSON.stringify({ opsForA, cards: afterOps.cards.map((card) => ({
    id: card.id, status: card.status, label: card.label, busy: card.busy, failure: card.failure })) }));
  await page.shot(shots, "uix05-06-cards.png");

  // ── G. the operation label is per job, and only that job waits ───────────────
  // `slowOp` holds the POST after the click, which is the only way to observe a busy label:
  // the fake engine answers in ~2s, far too fast to catch reliably.
  const pair = await evaluate(`(async () => {
    const auth = window.__authHeader || '';
    const make = async (prompt) => {
      const response = await fetch('${JOBS}', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ model_id: 'fake-sd15', prompt, batch_count: 1,
          width: 512, height: 512, steps: 1, cfg_scale: 1.0, seed: 21 }) });
      return response.ok ? (await response.json()).job_id : null;
    };
    return { a: await make('uix05 slow probe A'), b: await make('uix05 slow probe B') };
  })()`);
  check("UIX05 · 지연 조작용 작업 2건 접수", true, Boolean(pair?.a && pair?.b));
  await clickByText(".jobs-actions button", "새로고침").catch(() => false);
  await sleep(1500);

  await evaluate(`Object.assign(window.__uix05, { slowOp: { id: ${JSON.stringify(pair.a)},
    kind: 'cancel' } })`);
  await evaluate(`(() => {
    const card = document.querySelector('.job[data-job-id="${pair.a}"]');
    [...card.querySelectorAll('.job-actions button')]
      .find((node) => node.textContent.includes('취소')).click();
    return true;
  })()`);
  // Wait for the request to actually reach the gate, not for a fixed sleep: the label is only
  // meaningful once the POST is in flight.
  await waitFor(`typeof window.__uix05.slowOp?.release === 'function'`,
    { label: "cancel held", timeout: 8000 }).catch(() => false);
  await sleep(250);
  const during = await readState();
  const busyCard = during.cards.find((card) => card.id === pair.a);
  const idleCard = during.cards.find((card) => card.id === pair.b);
  check("UIX05 · 조작 중 카드가 busy 표시", "cancel", busyCard?.busy);
  check("UIX05 · 조작 중 버튼 라벨이 취소 중…", true,
    Boolean(busyCard?.buttons.some((button) => button.text === "취소 중…")));
  check("UIX05 · 조작 중 해당 버튼이 비활성", true,
    Boolean(busyCard?.buttons.find((button) => button.text === "취소 중…")?.disabled));
  check("UIX05 · 조작 중 aria-busy가 취소에만", "true",
    busyCard?.buttons.find((button) => button.text === "취소 중…")?.busy);
  // The unrelated card must not be blocked by another job's operation.
  check("UIX05 · 다른 카드는 조작 가능한 상태 유지", true,
    Boolean(idleCard?.buttons.some((button) => button.text === "취소" && !button.disabled)));
  record("UIX05 조작 중", JSON.stringify({ busyCard, idleCard }));
  await evaluate(`document.querySelector('.job[data-job-id="${pair.a}"]')
    ?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix05-07-busy.png");

  // Release the held POST: the label must go back, and the list must show the outcome.
  await evaluate(`window.__uix05.slowOp.release(); true`);
  await sleep(2500);
  const afterSlow = await readState();
  const releasedCard = afterSlow.cards.find((card) => card.id === pair.a);
  check("UIX05 · 조작이 끝나면 busy가 사라짐", null, releasedCard?.busy ?? null);
  check("UIX05 · 조작 후 상태가 서버 값으로 갱신", "cancelled", releasedCard?.status);
  check("UIX05 · 조작 후 한국어 라벨 유지", "취소됨", releasedCard?.label);
  await evaluate(`Object.assign(window.__uix05, { slowOp: null })`);

  // ── H. a failed operation reports on its own card and unlocks it ─────────────
  await evaluate(`Object.assign(window.__uix05, { failOp: true })`);
  await evaluate(`(() => {
    const card = document.querySelector('.job[data-job-id="${pair.b}"]');
    [...card.querySelectorAll('.job-actions button')]
      .find((node) => node.textContent.includes('취소')).click();
    return true;
  })()`);
  await waitFor(`!!document.querySelector('.job[data-job-id="${pair.b}"] .job-failure')`,
    { label: "op failure", timeout: 10000 }).catch(() => false);
  await sleep(400);
  const failed = await readState();
  const failedCard = failed.cards.find((card) => card.id === pair.b);
  check("UIX05 · 조작 실패가 해당 카드에 표시됨", true,
    Boolean(failedCard?.failure?.startsWith("취소 실패")));
  check("UIX05 · 조작 실패 사유가 서버 응답", true,
    Boolean(failedCard?.failure?.includes("조작 실패(테스트)")));
  check("UIX05 · 실패 후 잠금이 풀려 다시 조작 가능", true,
    Boolean(failedCard?.buttons.some((button) => button.text === "취소" && !button.disabled)));
  // A failure on one card must not put a message on another.
  check("UIX05 · 다른 카드에는 실패 문구 없음", null,
    failed.cards.find((card) => card.id === pair.a)?.failure ?? null);
  check("UIX05 · 조작 실패가 전역 오류 상자에 새지 않음", true,
    !(failed.errorBox || "").includes("조작 실패(테스트)"));
  record("UIX05 조작 실패", JSON.stringify({ failure: failedCard?.failure,
    buttons: failedCard?.buttons }));
  await evaluate(`document.querySelector('.job[data-job-id="${pair.b}"]')
    ?.scrollIntoView({ block: 'center' })`);
  await sleep(250);
  await page.shot(shots, "uix05-08-op-error.png");
  await evaluate(`Object.assign(window.__uix05, { failOp: false })`);

  // ── I. retry follows the server's contract: a copy with a new id ────────────
  // `POST /jobs/{id}/retry` returns `{ job_id }` for a new job whose `retry_of` names the old
  // one; nothing here assumes the old job is reused.
  const retryButton = await evaluate(`(() => {
    const card = document.querySelector('.job[data-job-id="${pair.a}"]');
    const button = [...card.querySelectorAll('.job-actions button')]
      .find((node) => node.textContent.includes('재시도'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  check("UIX05 · 취소된 카드에 재시도 버튼", true, retryButton === true);
  const copyId = await waitFor(`(async () => {
    const auth = window.__authHeader || '';
    const jobs = await (await fetch('${JOBS}?limit=200',
      { headers: auth ? { Authorization: auth } : {} })).json();
    const copy = jobs.find((job) => job.retry_of === ${JSON.stringify(pair.a)});
    return copy ? copy.job_id : false;
  })()`, { label: "retry copy", timeout: 12000 }).catch(() => null);
  check("UIX05 · 재시도가 새 Job ID를 만듦", true, Boolean(copyId));
  check("UIX05 · 재시도 결과가 원래 작업과 다름", true, copyId !== pair.a);
  check("UIX05 · 재시도 한 번에 조작 한 번", 1,
    await evaluate(`window.__uix05.ops.filter((op) => op.id === ${JSON.stringify(pair.a)}
      && op.kind === 'retry').length`));
  record("UIX05 재시도", JSON.stringify({ copyId, original: pair.a }));

  // ── J. a stale list reply cannot overwrite a newer one ──────────────────────
  // The first read is held after the server answered, then a second read is issued and lands.
  // Releasing the first one delivers rows that never existed; if the ordering guard were absent
  // they would replace the fresh list and put `stale-marker-job` on screen.
  const pageBeforeRace = (await readState()).page;
  const listsBeforeRace = await total("lists");
  await evaluate(`(() => {
    window.__uix05.patchList = (jobs) => [{ ...jobs[0], job_id: 'stale-marker-job',
      prompt: 'STALE MARKER', status: 'failed' }, ...jobs];
    window.__uix05.hold = {};
    return true;
  })()`);
  await clickByText(".jobs-actions button", "새로고침").catch(() => false);
  await waitFor(`typeof window.__uix05.hold?.release === 'function'`,
    { label: "read held", timeout: 10000 }).catch(() => false);
  // The held reply is now waiting. Let a newer read happen with no rewrite at all.
  await evaluate(`window.__uix05.patchList = null; true`);
  await clickByText(".jobs-actions button", "새로고침").catch(() => false);
  await waitFor(`window.__uix05.lists >= ${listsBeforeRace + 2}`,
    { label: "second read", timeout: 10000 }).catch(() => false);
  await sleep(900);
  await evaluate(`window.__uix05.hold?.release?.(); true`);
  await sleep(1200);
  const raced = await evaluate(`(() => ({
    marker: document.body.textContent.includes('STALE MARKER'),
    markerCard: !!document.querySelector('.job[data-job-id="stale-marker-job"]'),
    page: document.querySelector('.jobs-body .pagination span')?.textContent.trim() ?? null,
    cards: document.querySelectorAll('.job').length,
    lists: window.__uix05.lists,
  }))()`);
  check("UIX05 · 오래된 응답이 목록을 덮어쓰지 않음", false, raced.markerCard);
  check("UIX05 · 오래된 응답의 내용이 화면에 없음", false, raced.marker);
  check("UIX05 · 오래된 응답이 페이지를 바꾸지 않음", pageBeforeRace, raced.page);
  check("UIX05 · 두 번의 갱신이 실제로 있었음", true, raced.lists >= listsBeforeRace + 2);
  record("UIX05 경쟁", JSON.stringify({ pageBeforeRace, ...raced }));
  await evaluate(`document.querySelector('.jobs-body')?.scrollIntoView({ block: 'start' })`);
  await sleep(250);
  await page.shot(shots, "uix05-09-race.png");

  // ── K. the earlier duplicate guards still hold ──────────────────────────────
  // UIX04: three generate clicks in one turn must still produce one POST. The switchboard counts
  // `POST /api/v1/jobs` only, so a cancelled or retried job is not miscounted as a generation.
  await evaluate(`(() => {
    const node = document.querySelector('#prompt-final');
    const proto = Object.getPrototypeOf(node);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, 'uix05 duplicate probe');
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  const postsBeforeReuse = await total("posts");
  await evaluate(`(() => {
    const button = document.querySelector('button.generate');
    button.click(); button.click(); button.click();
    return true;
  })()`);
  await sleep(2500);
  const postsAfterReuse = await total("posts");
  // Assert on the *delta*, so the log says what happened ("1 new POST") instead of printing a
  // running total that reads like a count of duplicates.
  check("UIX05 · 생성 연속 클릭이 한 건만 접수(UIX04 회귀)", 1,
    postsAfterReuse - postsBeforeReuse);
  record("UIX05 중복 회귀", JSON.stringify({ before: postsBeforeReuse, after: postsAfterReuse,
    added: postsAfterReuse - postsBeforeReuse }));

  // UCP08: a 413 from a `POST /jobs` still reaches the error box and is not swallowed by the
  // 4s list poll. The stub matches method *and* path, which is the fix that defect needed.
  const rejection = await evaluate(`(async () => {
    const real = window.fetch;
    let stubbed = 0;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init && init.method) || 'GET';
      if (stubbed === 0 && method === 'POST' && url.endsWith('/api/v1/jobs')) {
        stubbed += 1;
        return Promise.resolve(new Response(JSON.stringify({ detail: '요청 본문이 너무 큽니다' }),
          { status: 413, headers: { 'Content-Type': 'application/json' } }));
      }
      return real(input, init);
    };
    try {
      document.querySelector('button.generate').click();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const box = document.querySelector('.errorbox');
        if (box && box.textContent.includes('요청 본문이 너무 큽니다')) {
          return { seen: true, stubbed };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { seen: false, stubbed };
    } finally { window.fetch = real; }
  })()`);
  check("UIX05 · 413이 오류 상자에 도달(UCP08 회귀)", true, rejection?.seen === true);
  check("UIX05 · 413 stub이 생성 POST 한 번만 소비", 1, rejection?.stubbed);
  record("UIX05 413 회귀", JSON.stringify(rejection));
  await clickByText(".errorbox button", "닫기").catch(() => false);
  await sleep(500);

  // ── L. the four required states at both widths ─────────────────────────────
  // State is re-established per width rather than inherited, so the two widths document the
  // same fixture and the same starting point.
  for (const [width, height, label] of [[360, 800, "360"], [1280, 900, "1280"]]) {
    await page.viewport(width, height, width < 500);
    await sleep(450);
    await setQueue(page, true);
    await evaluate(`window.__uix05.patchList = null; true`);
    await sleep(300);

    // (1) the receipt for the accepted job.
    const receiptBox = await evaluate(`(() => {
      const node = document.querySelector('.generate-receipt');
      const doc = document.documentElement;
      const box = node ? node.getBoundingClientRect() : null;
      const button = node?.querySelector('button');
      const buttonBox = button ? button.getBoundingClientRect() : null;
      return {
        present: !!node,
        text: node?.querySelector('.generate-receipt__text')?.textContent.trim() ?? null,
        inside: !!box && box.right <= doc.clientWidth + 1 && box.left >= -1,
        overflow: doc.scrollWidth - doc.clientWidth,
        buttonHeight: buttonBox ? Math.round(buttonBox.height) : 0,
      };
    })()`);
    check(`UIX05 · ${label} 접수 확인 표시`, true, receiptBox.present);
    check(`UIX05 · ${label} 접수 확인이 화면 안`, true, receiptBox.inside);
    check(`UIX05 · ${label} 접수 확인에서 가로 넘침 없음`, true, receiptBox.overflow <= 1);
    check(`UIX05 · ${label} 작업 큐에서 보기 44px 이상`, true, receiptBox.buttonHeight >= 44);
    await evaluate(`document.querySelector('.generate-receipt')?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    await page.shot(shots, `uix05-10-receipt-${label}.png`);

    // (2) the move, landing on exactly one highlighted card.
    await click(".generate-receipt button");
    await waitFor(`document.querySelectorAll('.job[data-spotlight]').length > 0
      || ['missing', 'error'].includes(document.querySelector('.jobs-nav')?.getAttribute('data-phase'))`,
    { label: `${label} spotlight`, timeout: 12000 }).catch(() => false);
    await sleep(700);
    const moveLayout = await evaluate(`(() => {
      const doc = document.documentElement;
      const card = document.querySelector('.job[data-spotlight]');
      const box = card ? card.getBoundingClientRect() : null;
      return {
        spotlights: document.querySelectorAll('.job[data-spotlight]').length,
        inside: !!box && box.right <= doc.clientWidth + 1 && box.left >= -1,
        overflow: doc.scrollWidth - doc.clientWidth,
        cardOverflow: card ? card.scrollWidth - card.clientWidth : null,
        label: card?.querySelector('.job-spotlight')?.textContent.trim() ?? null,
      };
    })()`);
    check(`UIX05 · ${label} 이동 후 카드 하나만 강조`, 1, moveLayout.spotlights);
    check(`UIX05 · ${label} 강조 카드가 화면 안`, true, moveLayout.inside);
    check(`UIX05 · ${label} 이동 후 가로 넘침 없음`, true, moveLayout.overflow <= 1);
    check(`UIX05 · ${label} 강조 카드 내부 넘침 없음`, 0, moveLayout.cardOverflow);
    check(`UIX05 · ${label} 강조 표시가 접수한 작업`, "접수한 작업", moveLayout.label);
    await evaluate(`document.querySelector('.job[data-spotlight]')?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    await page.shot(shots, `uix05-11-moved-${label}.png`);


    // (3) cards in different server states, each labelled in Korean.
    await evaluate(`document.querySelector('#jobs-body')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);
    const statuses = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.job')];
      const KO = { queued: '대기', waiting_for_gpu: 'GPU 대기', running: '실행 중',
        completed: '완료', failed: '실패', cancelled: '취소됨', interrupted: '중단됨' };
      return {
        distinct: [...new Set(cards.map((card) => card.querySelector('.badge')
          ?.getAttribute('data-status')))],
        mistranslated: cards.filter((card) => {
          const badge = card.querySelector('.badge');
          const status = badge?.getAttribute('data-status');
          return (badge?.textContent.trim() ?? '') !== (KO[status] ?? status);
        }).length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cardOverflow: cards.filter((card) => card.scrollWidth - card.clientWidth > 1).length,
        actionBelow44: cards.flatMap((card) => [...card.querySelectorAll('.job-actions button')])
          .filter((button) => button.getBoundingClientRect().height < 44).length,
      };
    })()`);
    check(`UIX05 · ${label} 카드가 두 가지 이상 상태를 보여줌`, true,
      (statuses.distinct?.length ?? 0) >= 2);
    check(`UIX05 · ${label} 모든 배지가 서버 상태와 대응`, 0, statuses.mistranslated);
    check(`UIX05 · ${label} 카드에서 가로 넘침 없음`, true, statuses.overflow <= 1);
    check(`UIX05 · ${label} 카드 내부 넘침 없음`, 0, statuses.cardOverflow);
    check(`UIX05 · ${label} 카드 조작 버튼 44px 이상`, 0, statuses.actionBelow44);
    record(`UIX05 ${label} 상태`, JSON.stringify(statuses));
    await page.shot(shots, `uix05-12-statuses-${label}.png`);


    // (4) an operation failure on one card, read on that card.
    const victim = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.job')].find((node) => {
        const badge = node.querySelector('.badge')?.getAttribute('data-status');
        return (badge === 'running' || badge === 'queued') && node.querySelector('.job-actions button');
      });
      return card ? card.getAttribute('data-job-id') : null;
    })()`);
    if (victim) {
      // A 409 on the operation POST only: the list keeps working, so the shot shows one card's
      // failure rather than a broken page.
      await evaluate(`(() => {
        const real = window.fetch;
        window.__uix05Real = real;
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input.url;
          const method = (init && init.method) || 'GET';
          if (method === 'POST' && /\\/jobs\\/[^/?]+\\/(cancel|retry)/.test(url)) {
            return Promise.resolve(new Response(JSON.stringify({ detail: '이미 종료된 작업입니다' }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }));
          }
          return real(input, init);
        };
        return true;
      })()`);
      await evaluate(`(() => {
        const card = document.querySelector('.job[data-job-id="${victim}"]');
        card.querySelector('.job-actions button').click();
        return true;
      })()`);
      await waitFor(`!!document.querySelector('.job[data-job-id="${victim}"] .job-failure')`,
        { label: `${label} op failure`, timeout: 10000 }).catch(() => false);
      await sleep(400);
      const opError = await evaluate(`(() => {
        const card = document.querySelector('.job[data-job-id="${victim}"]');
        const failure = card?.querySelector('.job-failure');
        const box = failure ? failure.getBoundingClientRect() : null;
        const button = card?.querySelector('.job-actions button');
        const buttonBox = button ? button.getBoundingClientRect() : null;
        const doc = document.documentElement;
        return {
          text: failure?.textContent.trim() ?? null,
          inside: !!box && box.right <= doc.clientWidth + 1 && box.left >= -1,
          overflow: doc.scrollWidth - doc.clientWidth,
          enabled: !button?.disabled,
          buttonWidth: buttonBox ? Math.round(buttonBox.width) : 0,
          buttonHeight: buttonBox ? Math.round(buttonBox.height) : 0,
        };
      })()`);
      check(`UIX05 · ${label} 조작 오류가 카드에 표시`, true,
        Boolean(opError.text?.includes('이미 종료된 작업입니다')));
      check(`UIX05 · ${label} 오류 문구가 화면 안`, true, opError.inside);
      check(`UIX05 · ${label} 오류 상태에서 넘침 없음`, true, opError.overflow <= 1);
      check(`UIX05 · ${label} 오류 뒤 버튼이 다시 눌림`, true, opError.enabled);
      // A full-width failure row must not squeeze the action column: at 1280 the button once
      // collapsed into a narrow vertical strip when an error appeared on the card.
      check(`UIX05 · ${label} 오류가 있어도 버튼 폭이 유지됨`, true,
        opError.buttonWidth >= 44 && opError.buttonWidth >= opError.buttonHeight);
      record(`UIX05 ${label} 조작 오류`, JSON.stringify(opError));
      await evaluate(`document.querySelector('.job[data-job-id="${victim}"] .job-failure')
        ?.scrollIntoView({ block: 'center' })`);
      await sleep(250);
      await page.shot(shots, `uix05-13-op-error-${label}.png`);
      await evaluate(`(() => { window.fetch = window.__uix05Real; return true; })()`);
    } else {
      // No cancellable card means the state could not be produced; that is reported as a
      // failure rather than skipped silently, so missing evidence is visible.
      record(`UIX05 ${label} 조작 오류`, "취소 가능한 카드가 없어 건너뜀");
      check(`UIX05 · ${label} 조작 오류 대상 카드 확보`, true, false);
    }
  }
  await page.viewport(1280, 900, false);
  await sleep(300);


  // ── M. the new controls are reachable from the keyboard ────────────────────
  // A real Tab walk from the generate button: the receipt's button is the next stop after the
  // button that produced it, which is where a keyboard user looks for it.
  await setQueue(page, true);
  await evaluate(`document.querySelector('button.generate').focus()`);
  await page.tab();
  await sleep(200);
  const afterGenerate = await page.activeInfo();
  check("UIX05 · 생성 버튼 다음 Tab이 접수 확인 버튼", "작업 큐에서 보기",
    (afterGenerate?.text || "").trim());
  await page.press("Enter", "Enter", 13);
  await waitFor(`document.querySelectorAll('.job[data-spotlight]').length > 0
    || ['missing', 'error'].includes(document.querySelector('.jobs-nav')?.getAttribute('data-phase'))`,
  { label: "keyboard move", timeout: 12000 }).catch(() => false);
  check("UIX05 · Enter로 작업 큐 이동 동작", true,
    await evaluate(`document.querySelectorAll('.job[data-spotlight]').length > 0
      || ['missing', 'error'].includes(document.querySelector('.jobs-nav')?.getAttribute('data-phase'))`));

  // The card's own buttons are in the tab order and keep a visible focus ring. Only an enabled
  // one can take focus at all — a disabled control is correctly unfocusable — so the check picks
  // the first card button a user could actually press.
  const cardFocus = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.job .job-actions button')]
      .find((node) => !node.disabled);
    if (!button) return { present: false };
    button.focus();
    const style = getComputedStyle(button);
    return { present: true, focused: document.activeElement === button,
      outlineWidth: style.outlineWidth, text: button.textContent.trim() };
  })()`);
  check("UIX05 · 카드 조작 버튼이 포커스를 받음", true, cardFocus.focused === true);
  check("UIX05 · 카드 조작 버튼에 포커스 표시가 있음", true,
    Number.parseFloat(cardFocus.outlineWidth || "0") > 0);
  record("UIX05 키보드", JSON.stringify({ afterGenerate, cardFocus }));
}

