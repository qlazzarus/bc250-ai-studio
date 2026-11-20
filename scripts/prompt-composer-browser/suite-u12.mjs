/**
 * U12 in a real browser: a v2 record must survive storage, a page reload and a retry.
 *
 * What is real here: the SQLite database in the disposable data dir, the HTTP read path,
 * the React history screen and the retry endpoint. What is *not*: the translation text.
 * The fake engine cannot produce one and this harness has no gate, so the translate
 * reply is stubbed in the page — the same stub the TRANS06 block uses. Every assertion
 * below is therefore about **storage and display**, never about translation quality.
 * Quality needs a live model (LIVE02/EVAL-UX02) and is reported as unverified.
 */
import { openBuilder, pickEntry } from "./ui.mjs";

const PHRASE_KO = "비치는 골목에 선";
const PHRASE_EN = "a street lit by neon";
const FREE_TEXT = "네온이 비치는 골목에 선 사람";

/** Calls the app's own API with the credential the app itself sent. */
const api = (expression) => `(async () => {
  const headers = { 'Content-Type': 'application/json' };
  if (window.__authHeader) headers.Authorization = window.__authHeader;
  ${expression}
})()`;

export async function runU12({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select, shot } = page;

  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.prompt-builder > .quiet')`, { label: "reload for U12", timeout: 20000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`, { label: "models after reload", timeout: 20000 });
  await select(".composer select", "fake-sd15");
  await sleep(600);
  await openBuilder(page);

  // ── S. produce a v2 record through the UI ───────────────────────────────────
  await evaluate(`(() => {
    window.__proposalReply = { translations: [
      { source_ko: ${JSON.stringify(PHRASE_KO)}, suggested_en: ${JSON.stringify(PHRASE_EN)}, confidence: 0.82 },
    ] };
    return true;
  })()`);
  await typeInto("#free-text-ko", FREE_TEXT);
  await pickEntry(page, "대상");
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 1`, { label: "one chip" });
  await click(".prompt-proposals__translate");
  await waitFor(`!!document.querySelector('.prompt-remainder-card')`, { label: "translation card" });
  await clickByText(".prompt-remainder-card button", "포함");
  await waitFor(`!!document.querySelector('.prompt-remainder-card[data-included]')`, { label: "included" });

  const needsDraft = await evaluate(`!![...document.querySelectorAll('.prompt-result button')]
    .find((node) => node.textContent.includes('초안 만들기'))`);
  if (needsDraft) {
    await clickByText(".prompt-result button", "초안 만들기");
    await waitFor(`!!document.querySelector('.prompt-draft')`, { label: "draft" });
  }
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".prompt-result button", "초안을 최종 프롬프트에 적용");
  await sleep(400);
  const applied = await evaluate(`(() => ({
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
    status: document.querySelector('.prompt-status strong')?.textContent?.trim() ?? null,
  }))()`);
  check("U12 · 적용된 최종 프롬프트가 번역으로 끝남", true,
    (applied.finalPrompt ?? "").endsWith(`\n${PHRASE_EN}`));

  await click("button.generate");
  const completed = await waitFor(api(`
    const jobs = await (await fetch('/api/v1/jobs?limit=5', { headers })).json();
    const job = jobs.find((item) => item.status === 'completed' && item.prompt_composition?.schema_version === 2);
    return job ? { jobId: job.job_id, assetId: job.output_asset_ids?.[0] ?? null } : false;
  `), { label: "v2 job completed", timeout: 30000 });
  check("U12 · v2 작업이 자산을 남김", true, Boolean(completed?.assetId));
  record("U12 제출 작업", JSON.stringify(completed));

  // ── T. the stored record as the API returns it ──────────────────────────────
  const stored = await evaluate(api(`
    const response = await fetch('/api/v1/assets/${completed.assetId}/metadata', { headers });
    const body = await response.json();
    const composition = body.prompt_composition ?? {};
    return {
      status: response.status,
      schema: composition.schema_version ?? null,
      remainder: composition.remainder ?? null,
      draft: composition.draft_prompt ?? null,
      prompt: body.prompt ?? null,
    };
  `));
  check("U12 · 조회된 기록이 v2", 2, stored.schema);
  check("U12 · 조회된 remainder 항목 1개", 1,
    Array.isArray(stored.remainder) ? stored.remainder.length : null);
  const entry = (stored.remainder ?? [])[0] ?? {};
  check("U12 · 조회된 원문/번역", `${PHRASE_KO}|${PHRASE_EN}`,
    `${entry.source_ko}|${entry.suggested_en}`);
  check("U12 · 조회된 출처", "prop-browser|stub",
    `${entry.proposal_id}|${entry.proposal_model}`);
  check("U12 · 조회된 수락 시각", true,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(entry.accepted_at ?? ""));
  check("U12 · draft_prompt에는 번역 없음", true,
    typeof stored.draft === "string" && !stored.draft.includes(PHRASE_EN));
  record("U12 저장된 기록", JSON.stringify({ ...stored, draft: stored.draft?.length }));

  // ── U. the history screen shows it, and still shows it after a reload ──────
  // A reload is the cheapest way to prove the screen reads the row instead of
  // reusing React state left over from the submit.
  const openHistory = async (label) => {
    // The gallery is polled every 4s, so a card that does not exist yet is a timing
    // fact, not a failure. Refresh, then find *this* asset by its id prefix — matching
    // the first card would read a leftover from an earlier section.
    const prefix = completed.assetId.slice(0, 8);
    await clickByText(".jobs-actions button", "새로고침").catch(() => false);
    await waitFor(`(() => [...document.querySelectorAll('.asset')]
      .some((node) => (node.textContent || '').includes(${JSON.stringify(prefix)})))()`,
      { label: `asset ${prefix} in gallery (${label})`, timeout: 25000 });
    const opened = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.asset')]
        .find((node) => (node.textContent || '').includes(${JSON.stringify(prefix)}));
      const button = card && [...card.querySelectorAll('button')]
        .find((node) => node.textContent.trim() === '정보');
      if (button) button.click();
      return !!button;
    })()`);
    if (!opened) throw new Error(`정보 button not found for asset ${prefix}`);
    await waitFor(`!!document.querySelector('.modal')`, { label: `metadata modal (${label})` });
    await clickByText(".modal summary", "프롬프트 구성 이력");
    await sleep(200);
    return evaluate(`(() => {
      const text = document.querySelector('.modal')?.textContent ?? '';
      return {
        included: /포함한 번역/.test(text),
        phrase: text.includes(${JSON.stringify(`${PHRASE_KO} → ${PHRASE_EN}`)}),
        provenance: /번역 출처: stub/.test(text),
        proposal: /번역 제안 prop-browser/.test(text),
        schema: /스키마 v2/.test(text),
        explanation: /차이는 아래에 기록된 포함 번역이며/.test(text),
        emptyClaim: /경고·출처: 별도 기록 없음/.test(text),
      };
    })()`);
  };

  const before = await openHistory("first");
  check("U12 · 이력 화면에 포함한 번역", true, before.included && before.phrase);
  check("U12 · 이력 화면에 번역 출처", true, before.provenance && before.proposal);
  check("U12 · 이력 화면에 스키마 v2", true, before.schema);
  check("U12 · 이력 화면이 차이를 번역으로 설명", true, before.explanation);
  check("U12 · 이력 화면이 출처 없음을 주장하지 않음", false, before.emptyClaim);
  record("U12 이력 화면", JSON.stringify(before));
  await shot(shots, "38-u12-history.png");

  await clickByText(".modal button", "이 설정으로 다시 생성");
  await sleep(600);
  const restored = await evaluate(`(() => {
    const panel = document.querySelector('.prompt-remainder-included');
    return {
      panel: panel ? [...panel.querySelectorAll('li, p')].map((n) => n.textContent).join(' | ') : null,
      status: document.querySelector('.prompt-status strong')?.textContent?.trim() ?? null,
      freeText: document.querySelector('#free-text-ko')?.value ?? null,
    };
  })()`);
  check("U12 · 복원 시 포함 목록이 기록에서 재구성", true,
    (restored.panel ?? "").includes(PHRASE_KO) && (restored.panel ?? "").includes(PHRASE_EN));
  check("U12 · 복원해도 원문 불변", FREE_TEXT, restored.freeText);
  // U12 finding: this record *does* hold provenance, so the headline may only claim the
  // applied string is unknown — not that no application info was recorded.
  check("U12 · 복원 상태 문구가 출처를 부정하지 않음", true,
    (restored.status ?? "").includes("적용 문자열 미기록")
    && !(restored.status ?? "").includes("적용 정보 기록 없음"));
  record("U12 복원", JSON.stringify(restored));
  await shot(shots, "39-u12-restored.png");

  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.prompt-builder > .quiet')`, { label: "reload after restore", timeout: 20000 });
  const after = await openHistory("after reload");
  check("U12 · 새로고침 후에도 이력 동일", true,
    after.included && after.phrase && after.provenance && after.schema);
  record("U12 새로고침 후 이력", JSON.stringify(after));
  await shot(shots, "40-u12-history-reloaded.png");
  await clickByText(".modal button", "닫기").catch(() => false);

  // ── V. retry keeps the record (the row, not the screen) ────────────────────
  // Retry needs a terminal job. The fake engine never fails, so the deterministic
  // terminal state is a cancellation of a second v2 job.
  const probe = await evaluate(api(`
    const created = await fetch('/api/v1/jobs', {
      method: 'POST', headers,
      body: JSON.stringify({
        model_id: 'fake-sd15', prompt: 'u12 retry probe\\n' + ${JSON.stringify(PHRASE_EN)},
        width: 512, height: 512, steps: 1, cfg_scale: 1.0, seed: 11, batch_count: 1,
        prompt_composition: {
          schema_version: 2, compiler_version: '1.3.0', target_family: 'sd15',
          selections: [], free_text_ko: ${JSON.stringify(PHRASE_KO)},
          draft_prompt: 'u12 retry probe',
          unresolved: [{ kind: 'free_text', text: ${JSON.stringify(PHRASE_KO)} }],
          remainder: [{
            source_ko: ${JSON.stringify(PHRASE_KO)},
            suggested_en: ${JSON.stringify(PHRASE_EN)},
            proposal_id: 'prop-browser', proposal_model: 'stub',
            accepted_at: '2026-11-19T04:05:06Z',
          }],
        },
      }),
    });
    const job = await created.json();
    if (created.status !== 202) return { error: created.status, body: job };
    await fetch('/api/v1/jobs/' + job.job_id + '/cancel', { method: 'POST', headers });
    return { jobId: job.job_id };
  `));
  check("U12 · 재시도용 v2 작업 접수", true, Boolean(probe?.jobId));

  const terminal = await (async () => {
    try {
      return await waitFor(api(`
        const job = await (await fetch('/api/v1/jobs/${probe?.jobId}', { headers })).json();
        return job.status === 'cancelled' ? job.status : false;
      `), { timeout: 10000, label: "cancelled" });
    } catch { return null; }
  })();

  if (terminal === "cancelled") {
    await clickByText(".jobs-actions button", "새로고침").catch(() => false);
    await sleep(900);
    const clicked = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.job')]
        .find((node) => node.textContent.includes('u12 retry probe'));
      const button = card && [...card.querySelectorAll('button')].find((b) => b.textContent.includes('재시도'));
      if (button) button.click();
      return !!button;
    })()`);
    check("U12 · 카드의 재시도 버튼", true, clicked);

    const copy = await (async () => {
      try {
        return await waitFor(api(`
          const jobs = await (await fetch('/api/v1/jobs?limit=10', { headers })).json();
          const copy = jobs.find((job) => job.retry_of === ${JSON.stringify(probe?.jobId)});
          return copy ? {
            jobId: copy.job_id,
            schema: copy.prompt_composition?.schema_version ?? null,
            remainder: copy.prompt_composition?.remainder ?? null,
            prompt: copy.prompt ?? null,
          } : false;
        `), { timeout: 10000, label: "retry copy" });
      } catch { return null; }
    })();
    check("U12 · 재시도가 새 작업을 만듦", true, Boolean(copy?.jobId));
    check("U12 · 재시도도 v2", 2, copy?.schema);
    const copied = (copy?.remainder ?? [])[0] ?? {};
    check("U12 · 재시도가 출처까지 보존", `${PHRASE_KO}|${PHRASE_EN}|prop-browser|stub`,
      `${copied.source_ko}|${copied.suggested_en}|${copied.proposal_id}|${copied.proposal_model}`);
    check("U12 · 재시도 prompt에 번역 1회", 1,
      (copy?.prompt ?? "").split(PHRASE_EN).length - 1);
    record("U12 재시도", JSON.stringify({ ...copy, remainder: copy?.remainder?.length ?? null }));
  } else {
    record("U12 재시도", `취소 작업을 만들지 못해 미검증 (terminal=${terminal})`);
    check("U12 · 재시도 경로 검증", "cancelled", terminal);
  }
  await shot(shots, "41-u12-retry.png");
}
