// Apply, overwrite-cancel, saved restore, family switch and capability failure
// (U05/U06/U08/U10). Uses only local fetch interception on this page.
import { openAdjust, openBuilder, setQueue } from "./ui.mjs";

export async function runContracts({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select, shot } = page;

  // ── I. apply keeps the draft and marks the status ─────────────────────────
  await evaluate(`window.confirm = () => true;`);
  const draft = await evaluate(`document.querySelector('.prompt-result textarea').value`);
  await clickByText(".prompt-result button", "적용");
  await sleep(300);
  check("적용 · 최종 프롬프트 일치", draft,
    await evaluate(`document.querySelector('.composer textarea[rows="5"]').value`));
  check("적용 · 상태 문구", true,
    await evaluate(`document.querySelector('.prompt-status strong')?.textContent.includes('적용')`));

  // Overwrite cancel must preserve a hand-edited prompt.
  await evaluate(`window.__c = 0; window.confirm = () => { window.__c += 1; return false; };`);
  await typeInto(".composer textarea[rows='5']", "직접 쓴 프롬프트");
  await clickByText(".prompt-result button", "적용");
  await sleep(300);
  check("덮어쓰기 · 취소 시 최종 유지", "직접 쓴 프롬프트",
    await evaluate(`document.querySelector('.composer textarea[rows="5"]').value`));
  check("덮어쓰기 · 확인창 호출", 1, await evaluate(`window.__c`));
  check("적용 후 수정 · 상태 문구", true,
    await evaluate(`document.querySelector('.prompt-status strong')?.textContent.includes('수정')`));
  await shot(shots, "10-applied.png");

  // ── J. generation and retry path ─────────────────────────────────────────
  await evaluate(`window.confirm = () => true;`);
  await typeInto(".composer textarea[rows='5']", "a quiet portrait, soft lighting");
  await waitFor(`!document.querySelector('button.generate').disabled`, { label: "generate enabled" });

  // UX02 queue: with no jobs the panel is folded, and the header still states the
  // counts. Nothing is expanded by the test before the first job arrives.
  const queueStart = await evaluate(`(() => ({
    toggle: document.querySelector('.jobs-actions button')?.textContent ?? null,
    counts: document.querySelector('.jobs-counts')?.textContent ?? null,
    footnote: document.querySelector('.jobs-footnote')?.textContent ?? null,
    cards: document.querySelectorAll('.job').length,
  }))()`);
  record("작업 큐 초기 상태", JSON.stringify(queueStart));

  await click("button.generate");
  await waitFor(`document.querySelectorAll('.job').length >= 1`, { timeout: 25000, label: "job" });
  await setQueue(page, true);
  await sleep(2500);
  record("생성 결과 상태", await evaluate(`document.querySelector('.job .badge')?.textContent`));
  check("직접 생성 · 작업 표시", true, await evaluate(`document.querySelectorAll('.job').length >= 1`));
  const queueAfter = await evaluate(`(() => ({
    open: !document.querySelector('#jobs-body').hidden,
    expanded: document.querySelector('.jobs-actions button')?.getAttribute('aria-expanded'),
    controls: document.querySelector('.jobs-actions button')?.getAttribute('aria-controls'),
    counts: document.querySelector('.jobs-counts')?.textContent ?? null,
  }))()`);
  check("작업 큐 · 첫 작업 후 펼쳐짐", "true", queueAfter.expanded);
  check("작업 큐 · aria-controls 연결", "jobs-body", queueAfter.controls);
  await shot(shots, "13-job.png");

  // ── K. saved restore reports unknown method, not a guess ────────────────
  const hasAsset = await evaluate(`document.querySelectorAll('.asset .asset-footer .quiet').length > 0`);
  if (hasAsset) {
    await click(".asset .asset-footer .quiet");
    await waitFor(`!!document.querySelector('.modal')`, { label: "metadata" });
    const reuseAvailable = await evaluate(
      `[...document.querySelectorAll('.modal button')].some((b) => b.textContent.includes('이 설정으로 다시 생성'))`);
    check("결과 정보 · 구성 이력 항목", reuseAvailable, true);
    await clickByText(".modal button", "이 설정으로 다시 생성").catch(() => false);
    await sleep(500);
    const restored = await evaluate(`(() => ({
      inclusion: document.querySelector('.prompt-inclusion')?.textContent ?? null,
      unknown: document.querySelector('.prompt-inclusion')?.hasAttribute('data-unknown') ?? false,
      status: document.querySelector('.prompt-status strong')?.textContent ?? null,
    }))()`);
    check("과거 복원 · 반영 방식 기록 없음 표시", true,
      restored.unknown || (restored.inclusion || "").includes("기록"));
    record("과거 복원 상태", JSON.stringify(restored));
    await shot(shots, "12-restored.png");
  } else {
    record("과거 복원", "생성 결과 없음 · 이 환경에서는 재사용 경로 미실행 (미검증으로 남김)");
  }

  // ── L. HTTP 422/413 must surface the rejection and keep the input ────────
  const jobStatus = async (status, detail) => {
    await evaluate(`(() => {
      if (!window.__realFetch) window.__realFetch = window.fetch;
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        if (url.includes("/jobs") && method === "POST") {
          return Promise.resolve(new Response(JSON.stringify({ detail: ${JSON.stringify(detail)} }),
            { status: ${status}, headers: { "Content-Type": "application/json" } }));
        }
        return window.__realFetch(input, init);
      };
      return true;
    })()`);
    await typeInto(".composer textarea[rows='5']", "kept prompt after rejection");
    await sleep(200);
    await click("button.generate");
    await waitFor(`!!document.querySelector('.errorbox')`, { label: `error ${status}`, timeout: 10000 });
    const state = await evaluate(`(() => ({
      message: document.querySelector('.errorbox')?.textContent ?? null,
      prompt: document.querySelector('.composer textarea[rows="5"]').value,
      enabled: !document.querySelector('button.generate').disabled,
    }))()`);
    check(`HTTP ${status} · 오류 표시`, true, (state.message || "").includes(detail));
    check(`HTTP ${status} · 입력 보존`, "kept prompt after rejection", state.prompt);
    check(`HTTP ${status} · 재시도 가능`, true, state.enabled);
    record(`HTTP ${status}`, JSON.stringify(state));
    await clickByText(".errorbox button", "닫기").catch(() => false);
    await sleep(200);
  };
  await jobStatus(422, "프롬프트 형식이 올바르지 않습니다.");
  await jobStatus(413, "요청 본문이 너무 큽니다.");
  await evaluate(`(() => { if (window.__realFetch) { window.fetch = window.__realFetch; delete window.__realFetch; } return true; })()`);

  // ── L2. family switch keeps the exact prompt and drops the stale draft ────
  const beforeSwitch = await evaluate(`document.querySelector('.composer textarea[rows="5"]').value`);
  await select(".composer select", "fake-flux2");
  await sleep(600);
  const switched = await evaluate(`(() => {
    const applyNode = [...document.querySelectorAll('.prompt-result button')].find((b) => b.textContent.includes('적용'));
    return {
      prompt: document.querySelector('.composer textarea[rows="5"]').value,
      hasResult: !!document.querySelector('.prompt-result'),
      regenerate: [...document.querySelectorAll('.prompt-result button')]
        .some((b) => b.textContent.includes('초안 만들기') || b.textContent.includes('다시 만들기')),
      applyDisabled: applyNode ? applyNode.disabled : null,
    };
  })()`);
  // VERIFY01: an exact match, not a length check — a silently rewritten prompt fails.
  check("계열 전환 · 최종 프롬프트 문자열 동일", beforeSwitch, switched.prompt);
  check("계열 전환 · 재생성 경로 제공", true, switched.regenerate || !switched.hasResult);
  check("계열 전환 · 적용 불가 상태", true, switched.applyDisabled !== false);
  record("계열 전환 상태", JSON.stringify({ ...switched, prompt: switched.prompt.length }));
  await shot(shots, "14-family-switch.png");

  // ── L3. same-family model switch keeps prompt, selections and apply state ──
  await select(".composer select", "fake-sd15");
  await sleep(600);
  await evaluate(`window.confirm = () => true;`);
  await page.clickByText(".prompt-result button", "초안 만들기").catch(() => false);
  await sleep(600);
  const beforeSameFamily = await evaluate(`(() => ({
    prompt: document.querySelector('.composer textarea[rows="5"]').value,
    chips: [...document.querySelectorAll('.prompt-chip__label')].map((n) => n.textContent),
    hasDraft: !!document.querySelector('.prompt-draft'),
    status: document.querySelector('.prompt-status strong')?.textContent ?? null,
  }))()`);
  await select(".composer select", "fake-sd15-alt");
  await sleep(700);
  const afterSameFamily = await evaluate(`(() => ({
    prompt: document.querySelector('.composer textarea[rows="5"]').value,
    chips: [...document.querySelectorAll('.prompt-chip__label')].map((n) => n.textContent),
    hasDraft: !!document.querySelector('.prompt-draft'),
    model: document.querySelector('.composer select').value,
  }))()`);
  check("같은 계열 전환 · 모델 변경됨", "fake-sd15-alt", afterSameFamily.model);
  check("같은 계열 전환 · 최종 프롬프트 동일", beforeSameFamily.prompt, afterSameFamily.prompt);
  check("같은 계열 전환 · 선택 유지", JSON.stringify(beforeSameFamily.chips),
    JSON.stringify(afterSameFamily.chips));
  check("같은 계열 전환 · 초안 유지", beforeSameFamily.hasDraft, afterSameFamily.hasDraft);
  record("같은 계열 전환", JSON.stringify({ before: beforeSameFamily.status,
    chips: afterSameFamily.chips.length, maybeCleared: !afterSameFamily.hasDraft }));
  await select(".composer select", "fake-sd15");
  await sleep(500);
  await shot(shots, "15-same-family.png");

  // ── L4. VERIFY02: a failed job's retry path through the card button ───────
  // The fake engine never fails, so the closest deterministic terminal state is a
  // real cancellation. verify.sh raises the fake delay so the job is still
  // cancellable when the request lands; without that the cancel races completion
  // and this whole block would be a flaky non-check.
  const probe = await evaluate(`(async () => {
    // Reuse the exact credential the app itself sends (captured in run.mjs); a bare
    // fetch would 401 and the retry block would degrade into an unverified branch.
    const auth = window.__authHeader || '';
    const response = await fetch('/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({ model_id: 'fake-sd15', prompt: 'retry probe', batch_count: 1,
        width: 512, height: 512, steps: 1, cfg_scale: 1.0, seed: 7 }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  })()`);
  const probeId = probe?.body?.job_id ?? null;
  const cancelStatus = probeId ? await evaluate(`(async () => {
    const auth = window.__authHeader || '';
    const response = await fetch('/api/v1/jobs/${probeId}/cancel',
      { method: 'POST', headers: auth ? { Authorization: auth } : {} });
    return response.status;
  })()`) : null;
  const terminal = probeId ? await (async () => {
    try {
      return await waitFor(`(async () => {
        const auth = window.__authHeader || '';
        const job = await (await fetch('/api/v1/jobs/${probeId}',
          { headers: auth ? { Authorization: auth } : {} })).json();
        return job.status === 'cancelled' ? job.status : false;
      })()`, { timeout: 8000, label: "probe cancelled" });
    } catch { return null; }
  })() : null;
  record("재시도 준비", JSON.stringify({ created: probe?.status ?? null, cancel: cancelStatus, terminal }));

  if (probeId && terminal === "cancelled") {
    await clickByText(".jobs-actions button", "새로고침").catch(() => false);
    await sleep(900);
    const retryCard = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.job')]
        .find((node) => node.textContent.includes('retry probe'));
      return card ? { badge: card.querySelector('.badge')?.textContent ?? null,
        retry: [...card.querySelectorAll('button')].some((b) => b.textContent.includes('재시도')) } : null;
    })()`);
    check("재시도 · 종료된 작업 카드", "cancelled", retryCard?.badge);
    check("재시도 · 카드에 재시도 버튼", true, retryCard?.retry);

    // Click the card button: that covers the UI wiring, and the follow-up API read
    // proves the new job actually copied the original spec instead of a default.
    await evaluate(`(() => {
      const card = [...document.querySelectorAll('.job')].find((node) => node.textContent.includes('retry probe'));
      const button = card && [...card.querySelectorAll('button')].find((b) => b.textContent.includes('재시도'));
      if (button) button.click();
      return !!button;
    })()`);
    const retryCopy = await (async () => {
      try {
        return await waitFor(`(async () => {
          const auth = window.__authHeader || '';
          const jobs = await (await fetch('/api/v1/jobs?limit=10',
            { headers: auth ? { Authorization: auth } : {} })).json();
          const copy = jobs.find((job) => job.retry_of === ${JSON.stringify(probeId)});
          return copy ? { job_id: copy.job_id, prompt: copy.prompt, model_id: copy.model_id,
            status: copy.status } : false;
        })()`, { timeout: 8000, label: "retry copy" });
      } catch { return null; }
    })();
    check("재시도 · 카드 버튼으로 새 작업 생성", true, Boolean(retryCopy?.job_id));
    check("재시도 · 구성 보존", "retry probe", retryCopy?.prompt);
    check("재시도 · 모델 보존", "fake-sd15", retryCopy?.model_id);
    record("재시도 결과", JSON.stringify(retryCopy));
  } else {
    record("재시도", `취소 작업을 만들지 못해 미검증 (cancel=${cancelStatus}, terminal=${terminal})`);
    check("재시도 · 경로 검증", "cancelled", terminal);
  }
  await shot(shots, "16-retry.png");

  // ── L5. capability network failure keeps direct generation working ───────
  // The earlier degradation test replaced capabilities with an empty 200 body;
  // this one makes the request fail outright, which is the other real failure mode.
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/system/capabilities")) return Promise.reject(new Error("offline"));
      return real(input, init);
    };
  })();` });
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.composer select')`, { timeout: 20000, label: "reload offline" });
  await sleep(1500);
  const offline = await evaluate(`(() => ({
    notice: [...document.querySelectorAll('.prompt-notice, .prompt-warning')]
      .some((node) => node.textContent.includes('구성 이력 저장을 지원하지 않')),
    builder: !!document.querySelector('.prompt-builder'),
    probe: !!document.querySelector('.prompt-result'),
  }))()`);
  check("capability 실패 · 안내 표시", true, offline.notice);
  check("capability 실패 · 화면 유지", true, offline.builder);
  record("capability 네트워크 실패", JSON.stringify(offline));
  await shot(shots, "17-capability-offline.png");

  // ── L6. LLM-I04: no capability means rule-based only, stated in one sentence ──
  // The AI action must be absent rather than disabled, and the rule-based panel must
  // still be the proposal path. This is the current real deployment state too.
  const proposalFallback = await evaluate(`(() => {
    const panel = document.querySelector('.prompt-proposals');
    const ai = panel ? panel.querySelector('.prompt-proposals__ai') : null;
    const rule = panel ? [...panel.querySelectorAll('button')]
      .find((node) => node.textContent.includes('원문에서 사전 항목 찾기')) : null;
    const fallback = panel ? [...panel.querySelectorAll('.prompt-hint')]
      .map((node) => node.textContent).find((text) => text.includes('AI 제안을 사용할 수 없습니다')) : null;
    return { panel: !!panel, ai: !!ai, aiDisabled: ai ? ai.disabled : null,
      rule: Boolean(rule), fallback: fallback ?? null };
  })()`);
  check("LLM-I04 · capability 없음 · AI 버튼 없음", false, proposalFallback.ai);
  check("LLM-I04 · capability 없음 · 규칙 제안 유지", true, proposalFallback.rule);
  check("LLM-I04 · capability 없음 · 폴백 문구", true, Boolean(proposalFallback.fallback));
  record("LLM-I04 폴백", JSON.stringify(proposalFallback));
  await shot(shots, "18-proposal-fallback.png");

  // ── M. capability failure: composition unsupported must degrade, not crash ─
  // The override has to survive a reload, so it is installed as a page script
  // instead of patching the current window only.
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/system/capabilities")) {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200,
          headers: { "Content-Type": "application/json" } }));
      }
      return real(input, init);
    };
  })();` });
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.composer select')`, { timeout: 20000, label: "reload" });
  await sleep(1500);
  const degraded = await evaluate(`(() => ({
    notice: [...document.querySelectorAll('.prompt-notice, .prompt-warning')]
      .some((node) => node.textContent.includes('구성 이력 저장을 지원하지 않')),
    builder: !!document.querySelector('.prompt-builder'),
    canStillType: (() => { const node = document.querySelector('.composer textarea[rows="5"]'); return !!node && !node.disabled; })(),
  }))()`);
  check("capability 미지원 · 안내 표시", true, degraded.notice);
  check("capability 미지원 · 화면 유지", true, degraded.builder);
  check("capability 미지원 · 직접 입력 가능", true, degraded.canStillType);
  record("capability 미지원", JSON.stringify(degraded));
  await shot(shots, "14-capability-off.png");

  // ── N. LLM-I04: supported capability → one explicit request, no auto-call ────
  // The fake engine cannot serve a proposal, so the only honest way to exercise the
  // supported path in isolation is to augment the real capabilities payload and stub
  // the proposal endpoint in this page. Nothing here is a real LLM result.
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = window.fetch;
    window.__proposalCalls = [];
    window.__proposalDelay = 0;
    window.__proposalReply = null;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/system/capabilities")) {
        const response = await real(input, init);
        const body = await response.json().catch(() => ({}));
        body.prompt_proposals = { schema_versions: [1], dictionary_version: "1.2.0",
          timeout_ms: 20000, max_response_bytes: 16384 };
        return new Response(JSON.stringify(body), { status: response.status,
          headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/prompt/proposals")) {
        const body = JSON.parse(init.body);
        window.__proposalCalls.push(body);
        const delay = window.__proposalDelay;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return new Response(JSON.stringify({
          proposal_id: "prop-browser", request_id: body.request_id, status: "ready",
          kind: body.kind, provider: { model: "stub", version: "test", latency_ms: 1, finish_reason: "stop" },
          revisions: body.revisions,
          suggestions: window.__proposalReply?.suggestions ?? [{ id: "lighting.neon", matched_phrase: "네온", basis: "quote",
            polarity: "affirmed", actor: null, confidence: 0.9, reason_ko: "" }],
          variants: window.__proposalReply?.variants ?? [],
          unresolved_spans: window.__proposalReply?.unresolved_spans ?? [],
          ambiguities: window.__proposalReply?.ambiguities ?? [],
          rejected: [], truncated: window.__proposalReply?.truncated ?? false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return real(input, init);
    };
  })();` });
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.prompt-proposals')`, { timeout: 20000, label: "reload supported" });
  await sleep(1500);
  // The reload closes the composer; every value below lives inside that panel.
  await openBuilder(page);

  const aiButton = await evaluate(`(() => {
    const button = document.querySelector('.prompt-proposals__ai');
    return { present: !!button, label: button ? button.textContent.trim() : null,
      fallback: [...document.querySelectorAll('.prompt-proposals .prompt-hint')]
        .some((node) => node.textContent.includes('AI 제안을 사용할 수 없습니다')) };
  })()`);
  check("LLM-I04 · capability 있음 · AI 버튼 표시", true, aiButton.present);
  check("LLM-I04 · capability 있음 · 버튼 이름", "장면 정리하기", aiButton.label);
  check("LLM-I04 · capability 있음 · 폴백 문구 없음", false, aiButton.fallback);

  // A loaded page must not call the endpoint on its own.
  await sleep(1200);
  check("LLM-I04 · 자동 호출 없음", 0, await evaluate(`window.__proposalCalls.length`));

  await typeInto("#free-text-ko", "네온이 비치는 골목에 선 사람");
  await sleep(300);
  check("LLM-I04 · 입력만으로 호출 없음", 0, await evaluate(`window.__proposalCalls.length`));

  await clickByText(".prompt-proposals button", "장면 정리하기");
  await waitFor(`!!document.querySelector('.prompt-proposals__status')`, { label: "proposal status" });
  await sleep(600);
  const answered = await evaluate(`(() => ({
    calls: window.__proposalCalls.length,
    kind: window.__proposalCalls[0]?.kind ?? null,
    family: window.__proposalCalls[0]?.target_family ?? null,
    text: window.__proposalCalls[0]?.free_text_ko ?? null,
    hasRevisions: Object.keys(window.__proposalCalls[0]?.revisions ?? {}).length,
    status: document.querySelector('.prompt-proposals__status')?.textContent ?? null,
    freeText: document.querySelector('#free-text-ko').value,
    chips: document.querySelectorAll('.prompt-chip').length,
  }))()`);
  check("LLM-I04 · 버튼 한 번에 요청 한 번", 1, answered.calls);
  check("LLM-I04 · 요청 kind", "selection_hint", answered.kind);
  check("LLM-I04 · 원문 그대로 전송", "네온이 비치는 골목에 선 사람", answered.text);
  check("LLM-I04 · revisions 3개", 3, answered.hasRevisions);
  check("LLM-I04 · 응답 상태 표시", true, /제안 1개를 받았습니다/.test(answered.status ?? ""));
  check("LLM-I04 · 원문 불변", "네온이 비치는 골목에 선 사람", answered.freeText);
  record("LLM-I04 응답", JSON.stringify(answered));
  await shot(shots, "19-proposal-answered.png");

  // ── O. LLM-I04: an answer for a state the user already left is discarded ─────
  await evaluate(`window.__proposalDelay = 900;`);
  const chipsBefore = await evaluate(`document.querySelectorAll('.prompt-chip').length`);
  await clickByText(".prompt-proposals button", "장면 정리하기");
  await sleep(150);
  // The user edits while the request is in flight; nothing may be adopted.
  await typeInto("#free-text-ko", "네온이 비치는 골목에 선 사람, 그리고 개");
  await sleep(1100);
  const stale = await evaluate(`(() => ({
    calls: window.__proposalCalls.length,
    status: document.querySelector('.prompt-proposals__status')?.textContent ?? null,
    freeText: document.querySelector('#free-text-ko').value,
    chips: document.querySelectorAll('.prompt-chip').length,
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
  }))()`);
  check("LLM-I04 · 두 번째 요청", 2, stale.calls);
  check("LLM-I04 · 오래된 응답 폐기 문구", true, /이전 제안을 버렸습니다/.test(stale.status ?? ""));
  check("LLM-I04 · 편집한 원문 유지", "네온이 비치는 골목에 선 사람, 그리고 개", stale.freeText);
  check("LLM-I04 · 선택 불변", chipsBefore, stale.chips);
  record("LLM-I04 오래된 응답", JSON.stringify(stale));
  await shot(shots, "20-proposal-stale.png");

  // ── P. LLM-I05: cards, explicit accept, explicit reject ──────────────────────
  // The reply is widened to four kinds so the panel's separation is observable:
  // a quoted item, an inferred one, an unresolved span and an ambiguity. Still a page
  // stub, still not a model result.
  await evaluate(`(() => {
    window.__proposalReply = {
      suggestions: [
        { id: "lighting.neon", matched_phrase: "네온", basis: "quote", polarity: "affirmed",
          actor: null, confidence: 0.9, reason_ko: "조명 조건" },
        { id: "subject.dog", matched_phrase: "개", basis: "inferred", polarity: "affirmed",
          actor: null, confidence: 0.55, reason_ko: "" },
      ],
      unresolved_spans: [{ text: "골목에 선", why: "no_dictionary_entry", polarity: "affirmed" }],
      ambiguities: [{ text: "그 사람", why: "actor_unknown", candidates: ["subject.person"] }],
      truncated: false,
    };
    return true;
  })()`);
  await typeInto("#free-text-ko", "네온이 비치는 골목에 선 사람과 개");
  await sleep(200);
  const chipsBeforeCards = await evaluate(`document.querySelectorAll('.prompt-chip').length`);
  const promptBeforeCards = await evaluate(`document.querySelector('.composer textarea[rows="5"]').value`);
  await clickByText(".prompt-proposals button", "장면 정리하기");
  await waitFor(`!!document.querySelector('.prompt-cards')`, { label: "proposal cards" });
  await sleep(400);

  const cards = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.prompt-card')];
    const batch = [...document.querySelectorAll('.prompt-cards__actions button')]
      .find((node) => node.textContent.includes('선택에 추가'));
    const dismiss = [...document.querySelectorAll('.prompt-cards__actions button')]
      .find((node) => node.textContent.includes('제안 닫기'));
    return {
      count: nodes.length,
      kinds: nodes.map((node) => node.dataset.kind),
      labels: nodes.map((node) => node.querySelector('strong')?.textContent ?? null),
      acceptButtons: nodes.filter((node) => node.querySelector('button')).length,
      // An inferred card keeps its own accept button; it is only left out of the batch.
      inferredAccepts: nodes.filter((node) => node.dataset.kind === 'inferred')
        .every((node) => Boolean(node.querySelector('button'))),
      spanAccepts: nodes.filter((node) => node.dataset.kind === 'unresolved' || node.dataset.kind === 'ambiguous')
        .some((node) => Boolean(node.querySelector('button'))),
      batchLabel: batch ? batch.textContent.trim() : null,
      dismiss: !!dismiss,
      status: document.querySelector('.prompt-proposals__status')?.textContent ?? null,
      freeText: document.querySelector('#free-text-ko').value,
      chips: document.querySelectorAll('.prompt-chip').length,
      finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
    };
  })()`);
  check("LLM-I05 · 카드 4개", 4, cards.count);
  check("LLM-I05 · 유형 구분", "quoted,inferred,unresolved,ambiguous", cards.kinds.join(","));
  check("LLM-I05 · 미표현 구절 원문", true, cards.labels.includes("골목에 선"));
  check("LLM-I05 · 수락 버튼은 2개", 2, cards.acceptButtons);
  check("LLM-I05 · AI 추가도 개별 수락", true, cards.inferredAccepts);
  check("LLM-I05 · 구절은 수락 불가", false, cards.spanAccepts);
  check("LLM-I05 · 일괄 문구는 원문 근거만", true, /원문 근거 1개 선택에 추가/.test(cards.batchLabel ?? ""));
  check("LLM-I05 · 닫기 제공", true, cards.dismiss);
  check("LLM-I05 · 수락 전 원문 불변", "네온이 비치는 골목에 선 사람과 개", cards.freeText);
  check("LLM-I05 · 수락 전 선택 불변", chipsBeforeCards, cards.chips);
  check("LLM-I05 · 수락 전 최종 prompt 불변", promptBeforeCards, cards.finalPrompt);
  record("LLM-I05 카드", JSON.stringify(cards));
  await shot(shots, "21-proposal-cards.png");

  // Single accept: only the quoted card enters the selection, and the text stays.
  await clickByText(".prompt-card[data-kind='quoted'] button", "선택에 추가");
  await sleep(400);
  const accepted = await evaluate(`(() => ({
    chips: [...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent),
    freeText: document.querySelector('#free-text-ko').value,
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
    status: document.querySelector('.prompt-proposals__status')?.textContent ?? null,
    focused: Boolean(document.activeElement && document.activeElement !== document.body),
    focusTag: document.activeElement?.tagName ?? null,
    focusText: (document.activeElement?.textContent ?? '').trim().slice(0, 30),
    cards: document.querySelectorAll('.prompt-card').length,
  }))()`);
  check("LLM-I05 · 수락 시 선택 추가", true, accepted.chips.includes("네온 조명"));
  check("LLM-I05 · 수락 시 원문 유지", "네온이 비치는 골목에 선 사람과 개", accepted.freeText);
  check("LLM-I05 · 수락은 최종 prompt 불변", promptBeforeCards, accepted.finalPrompt);
  check("LLM-I05 · 수락 후 상태 문구", true, /선택에 반영했습니다/.test(accepted.status ?? ""));
  check("LLM-I05 · 수락 후 포커스 유지", "BUTTON", accepted.focusTag);
  record("LLM-I05 수락", JSON.stringify(accepted));
  await shot(shots, "22-proposal-accepted.png");

  // Reject: closing the panel removes the cards and leaves the selection alone.
  const chipsBeforeDismiss = await evaluate(`document.querySelectorAll('.prompt-chip').length`);
  await clickByText(".prompt-cards__actions button", "제안 닫기");
  await sleep(300);
  const dismissed = await evaluate(`(() => ({
    cards: document.querySelectorAll('.prompt-card').length,
    chips: document.querySelectorAll('.prompt-chip').length,
    freeText: document.querySelector('#free-text-ko').value,
    notice: [...document.querySelectorAll('.prompt-builder p[role="status"]')]
      .map((node) => node.textContent).join(' | '),
  }))()`);
  check("LLM-I05 · 거절 시 카드 제거", 0, dismissed.cards);
  check("LLM-I05 · 거절 시 선택 불변", chipsBeforeDismiss, dismissed.chips);
  check("LLM-I05 · 거절 시 원문 불변", "네온이 비치는 골목에 선 사람과 개", dismissed.freeText);
  check("LLM-I05 · 거절 안내 문구", true, /AI 제안을 닫았습니다/.test(dismissed.notice ?? ""));
  record("LLM-I05 거절", JSON.stringify(dismissed));
  await shot(shots, "23-proposal-dismissed.png");

  // Stale cards must not survive the next keystroke.
  await clickByText(".prompt-proposals button", "장면 정리하기");
  await waitFor(`!!document.querySelector('.prompt-cards')`, { label: "proposal cards again" });
  await typeInto("#free-text-ko", "네온이 비치는 골목에 선 사람과 개, 우산");
  await sleep(500);
  const revoked = await evaluate(`(() => ({
    cards: document.querySelectorAll('.prompt-card').length,
    status: document.querySelector('.prompt-proposals__status')?.textContent ?? null,
    chips: document.querySelectorAll('.prompt-chip').length,
  }))()`);
  check("LLM-I05 · 편집 후 카드 철회", 0, revoked.cards);
  check("LLM-I05 · 편집 후 철회 문구", true, /이전 제안을 버렸습니다/.test(revoked.status ?? ""));
  record("LLM-I05 철회", JSON.stringify(revoked));
  await shot(shots, "24-proposal-revoked.png");

  // ── Q. LLM-I06: partial change, diff and one-step undo ───────────────────────
  // The page stub answers `partial_change` with one in-scope item, one out-of-scope
  // item and one locked item, so the three refusals are observable in the DOM.
  await openBuilder(page);
  await typeInto("#free-text-ko", "네온이 비치는 골목에 선 사람과 개");
  await sleep(200);
  // Section P left a chip behind; clear it so the lock count is this section's own.
  await evaluate(`window.confirm = () => true;`);
  const clearButton = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.prompt-groups .quiet')]
      .find((node) => node.textContent.trim() === '선택 비우기');
    if (button) { button.click(); return true; }
    return false;
  })()`);
  if (clearButton) await sleep(300);
  // A selection outside the target group becomes a lock: subject.person.
  await clickByText(".prompt-categories button", "대상");
  await sleep(200);
  await evaluate(`(() => {
    const box = [...document.querySelectorAll('.prompt-choice input')]
      .find((node) => node.closest('label').textContent.includes('인물'));
    if (box && !box.checked) { box.click(); }
    return true;
  })()`);
  await sleep(300);
  const chipsBeforeScope = await evaluate(`[...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent)`);
  const finalBeforeScope = await evaluate(`document.querySelector('.composer textarea[rows="5"]').value`);

  await clickByText(".prompt-scope > summary", "부분 변경 범위");
  await clickByText(".prompt-scope__groups button", "배경");
  await sleep(250);
  const scope = await evaluate(`(() => ({
    label: document.querySelector('.prompt-scope > summary')?.textContent ?? null,
    pressed: [...document.querySelectorAll('.prompt-scope__groups button[aria-pressed="true"]')]
      .map((node) => node.textContent.replace(/\\d+$/, '').trim()),
    aiLabel: document.querySelector('.prompt-proposals__ai')?.textContent ?? null,
    lockNote: document.querySelector('.prompt-scope .prompt-hint')?.textContent ?? null,
  }))()`);
  check("LLM-I06 · 범위 문구에 고정 개수", true, /배경만 변경 · 고정 1개/.test(scope.label ?? ""));
  check("LLM-I06 · 범위 버튼 눌림 표시", "배경", scope.pressed.join(","));
  check("LLM-I06 · 버튼 이름이 부분 변경으로", "선택한 그룹만 정리", scope.aiLabel?.trim());
  check("LLM-I06 · 고정은 동일 인물 보장이 아님", true,
    /동일 인물을 보장하지 않습니다/.test(scope.lockNote ?? ""));
  record("LLM-I06 범위", JSON.stringify(scope));
  await shot(shots, "25-partial-scope.png");

  // The request carries the scope, and the reply's out-of-scope and locked items are
  // blocked before any click can reach the scene.
  await evaluate(`(() => {
    window.__proposalReply = {
      suggestions: [
        { id: "setting.plain_background", matched_phrase: "골목", basis: "quote", polarity: "affirmed",
          actor: null, confidence: 0.88, reason_ko: "장소" },
        { id: "lighting.neon", matched_phrase: "네온", basis: "quote", polarity: "affirmed",
          actor: null, confidence: 0.7, reason_ko: "범위 밖" },
        { id: "subject.person", matched_phrase: "사람", basis: "quote", polarity: "affirmed",
          actor: null, confidence: 0.9, reason_ko: "고정" },
      ],
      unresolved_spans: [], ambiguities: [], truncated: false,
    };
    return true;
  })()`);
  const callsBeforePartial = await evaluate(`window.__proposalCalls.length`);
  await clickByText(".prompt-proposals button", "선택한 그룹만 정리");
  await waitFor(`!!document.querySelector('.prompt-diff')`, { label: "partial diff" });
  await sleep(400);
  const partial = await evaluate(`(() => {
    const call = window.__proposalCalls[window.__proposalCalls.length - 1] ?? {};
    const cards = [...document.querySelectorAll('.prompt-card')];
    return {
      calls: window.__proposalCalls.length - ${callsBeforePartial},
      kind: call.kind ?? null,
      groups: call.target_groups ?? null,
      locked: call.locked_ids ?? null,
      cards: cards.length,
      acceptButtons: cards.filter((node) => node.querySelector('button')).length,
      blocked: cards.filter((node) => node.dataset.blocked).length,
      heading: document.querySelector('.prompt-cards__head strong')?.textContent ?? null,
      diffCounts: document.querySelector('.prompt-diff__counts')?.textContent
        .replace(/\\s+/g, ' ').trim() ?? null,
      diffRows: [...document.querySelectorAll('.prompt-diff__rows > li')]
        .map((node) => node.dataset.diff + ':' + node.querySelector('strong').textContent),
      lockNote: document.querySelector('.prompt-diff .prompt-hint')?.textContent ?? null,
      freeText: document.querySelector('#free-text-ko').value,
      chips: [...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent),
    };
  })()`);
  check("LLM-I06 · 부분 변경 요청 1회", 1, partial.calls);
  check("LLM-I06 · 요청 kind", "partial_change", partial.kind);
  check("LLM-I06 · 요청 target_groups", JSON.stringify(["setting"]), JSON.stringify(partial.groups));
  check("LLM-I06 · 요청 locked_ids", JSON.stringify(["subject.person"]), JSON.stringify(partial.locked));
  check("LLM-I06 · 제목이 부분 변경", true, /부분 변경 제안 3개/.test(partial.heading ?? ""));
  check("LLM-I06 · 범위 밖·고정 카드 차단", 2, partial.blocked);
  check("LLM-I06 · 수락 가능 카드는 1개", 1, partial.acceptButtons);
  check("LLM-I06 · diff 머리글", "고정 1 · 추가 1 · 적용 불가 1", partial.diffCounts);
  check("LLM-I06 · diff 행 구분", "kept:인물,change:단색 배경,blocked:네온 조명",
    partial.diffRows.join(","));
  check("LLM-I06 · diff 고정 안내", true, /동일 인물을 보장하지 않습니다/.test(partial.lockNote ?? ""));
  check("LLM-I06 · 수락 전 원문 불변", "네온이 비치는 골목에 선 사람과 개", partial.freeText);
  check("LLM-I06 · 수락 전 선택 불변", chipsBeforeScope.join(","), partial.chips.join(","));
  record("LLM-I06 부분 변경", JSON.stringify(partial));
  await shot(shots, "26-partial-diff.png");

  // Accept the only in-scope card, then undo exactly that click.
  await clickByText(".prompt-card:not([data-blocked]) button", "선택에 추가");
  await sleep(400);
  const partialAccepted = await evaluate(`(() => ({
    chips: [...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent),
    undo: document.querySelector('.prompt-undo button')?.textContent?.trim() ?? null,
    undoDisabled: document.querySelector('.prompt-undo button')?.disabled ?? null,
    freeText: document.querySelector('#free-text-ko').value,
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
  }))()`);
  check("LLM-I06 · 수락 시 대상 항목만 추가", true, partialAccepted.chips.includes("단색 배경"));
  check("LLM-I06 · 수락해도 원문 불변", "네온이 비치는 골목에 선 사람과 개", partialAccepted.freeText);
  check("LLM-I06 · 수락해도 최종 prompt 불변", finalBeforeScope, partialAccepted.finalPrompt);
  check("LLM-I06 · 되돌리기 버튼 노출", "“단색 배경” 추가 되돌리기", partialAccepted.undo);
  check("LLM-I06 · 되돌리기 사용 가능", false, partialAccepted.undoDisabled);
  record("LLM-I06 수락", JSON.stringify(partialAccepted));
  await shot(shots, "27-partial-accepted.png");

  await clickByText(".prompt-undo button", "되돌리기");
  await sleep(400);
  const undone = await evaluate(`(() => ({
    chips: [...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent),
    undo: document.querySelector('.prompt-undo button')?.textContent ?? null,
    notice: [...document.querySelectorAll('.prompt-builder p[role="status"]')]
      .map((node) => node.textContent).join(' | '),
    freeText: document.querySelector('#free-text-ko').value,
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
  }))()`);
  check("LLM-I06 · 되돌리면 선택 복원", chipsBeforeScope.join(","), undone.chips.join(","));
  check("LLM-I06 · 되돌리기 후 버튼 사라짐", null, undone.undo);
  check("LLM-I06 · 되돌리기 안내 문구", true, /되돌렸습니다/.test(undone.notice ?? ""));
  check("LLM-I06 · 되돌려도 원문 불변", "네온이 비치는 골목에 선 사람과 개", undone.freeText);
  check("LLM-I06 · 되돌려도 최종 prompt 불변", finalBeforeScope, undone.finalPrompt);
  record("LLM-I06 되돌리기", JSON.stringify(undone));
  await shot(shots, "28-partial-undone.png");

  // After an edit the record no longer describes the screen, so the undo is refused
  // instead of guessing which chips came from the proposal.
  await clickByText(".prompt-card:not([data-blocked]) button", "선택에 추가");
  await sleep(350);
  await typeInto("#free-text-ko", "네온이 비치는 골목에 선 사람과 개, 우산");
  await sleep(450);
  const blockedUndo = await evaluate(`(() => {
    const button = document.querySelector('.prompt-undo button');
    return {
      cards: document.querySelectorAll('.prompt-card').length,
      undo: button?.textContent ?? null,
      disabled: button?.disabled ?? null,
      hint: document.querySelector('.prompt-undo small')?.textContent ?? null,
      notice: [...document.querySelectorAll('.prompt-builder p[role="status"]')]
        .map((node) => node.textContent).join(' | '),
    };
  })()`);
  check("LLM-I06 · 편집 후 카드 철회", 0, blockedUndo.cards);
  check("LLM-I06 · 편집 후 되돌리기 차단", true, blockedUndo.disabled);
  check("LLM-I06 · 차단 사유 문구", true,
    /되돌릴 수 없습니다/.test(`${blockedUndo.undo} ${blockedUndo.hint} ${blockedUndo.notice}`));
  record("LLM-I06 되돌리기 차단", JSON.stringify(blockedUndo));
  await shot(shots, "29-partial-undo-blocked.png");

  // ── R. VAR02: three situations, one explicit apply, one-step undo ────────────
  // The stub answers `situation_variants` with two usable candidates and one that
  // changes the cast. Still a page stub: no model produced these sentences.
  await typeInto("#free-text-ko", "같은 인물과 의상으로 다른 상황");
  await sleep(200);
  await evaluate(`window.confirm = () => true;`);
  const clearedForVariants = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.prompt-groups .quiet')]
      .find((node) => node.textContent.trim() === '선택 비우기');
    if (button) { button.click(); return true; }
    return false;
  })()`);
  if (clearedForVariants) await sleep(300);

  // A fixed cast: 인물 + 흰 셔츠, and one place/action pair the candidates replace.
  const addChip = async (label) => {
    await openAdjust(page);
    await clickByText(".prompt-categories button", "전체");
    await sleep(150);
    await typeInto("#prompt-search", label);
    await sleep(250);
    const added = await evaluate(`(() => {
      const box = [...document.querySelectorAll('.prompt-choice input')].find((node) => !node.checked);
      if (!box) return false;
      box.click();
      return true;
    })()`);
    await typeInto("#prompt-search", "");
    await sleep(250);
    return added;
  };
  for (const label of ["인물", "흰 셔츠", "거리", "서 있기"]) {
    const ok = await addChip(label);
    if (!ok) throw new Error(`variant cast chip not found: ${label}`);
  }
  const chipsBeforeVariants = await evaluate(`[...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent)`);
  const promptBeforeVariants = await evaluate(`document.querySelector('.composer textarea[rows="5"]').value`);
  check("VAR02 · 기준 선택 4개", 4, chipsBeforeVariants.length);

  await evaluate(`(() => {
    window.__proposalReply = {
      suggestions: [], unresolved_spans: [], ambiguities: [], truncated: false,
      variants: [
        { variant_id: "v1", label_ko: "공원에서 걷기", prompt_ko: "같은 인물이 공원을 걷는다",
          changed_ids: ["setting.park", "action.walking"], removed_ids: ["location.street", "action.standing"],
          unresolved_ko: [] },
        { variant_id: "v2", label_ko: "카페에 앉기", prompt_ko: "같은 인물이 카페에 앉아 있다",
          changed_ids: ["setting.cafe", "pose.sitting"], removed_ids: ["location.street", "action.standing"],
          unresolved_ko: ["우산을 접으며"] },
        { variant_id: "v3", label_ko: "개와 함께", prompt_ko: "같은 인물이 개와 함께 있다",
          changed_ids: ["subject.dog"], removed_ids: [], unresolved_ko: [] },
      ],
    };
    return true;
  })()`);
  // The cast stays locked: the request may only name place and action.
  const callsBeforeVariants = await evaluate(`window.__proposalCalls.length`);
  await clickByText(".prompt-proposals button", "장소와 행동만 바꾼 상황 3개");
  await waitFor(`!!document.querySelector('.prompt-variants')`, { label: "variant cards" });
  await sleep(400);

  const variantCards = await evaluate(`(() => {
    const call = window.__proposalCalls[window.__proposalCalls.length - 1] ?? {};
    const nodes = [...document.querySelectorAll('.prompt-variant')];
    return {
      calls: window.__proposalCalls.length - ${callsBeforeVariants},
      kind: call.kind ?? null,
      groups: call.target_groups ?? null,
      locked: call.locked_ids ?? null,
      count: nodes.length,
      headline: document.querySelector('.prompt-variants__head strong')?.textContent ?? null,
      labels: nodes.map((node) => node.querySelector('strong')?.textContent ?? null),
      blocked: nodes.filter((node) => node.dataset.blocked).length,
      applyButtons: nodes.filter((node) => node.querySelector('button')).length,
      changes: nodes.map((node) => [...node.querySelectorAll('.prompt-variant__changes > li')]
        .map((item) => item.dataset.direction + ':' + item.textContent.trim()).join('|')),
      blocks: [...document.querySelectorAll('.prompt-variant__block')].map((node) => node.textContent.trim()),
      unresolved: document.querySelector('.prompt-variant__unresolved')?.textContent ?? null,
      status: document.querySelector('.prompt-proposals__status')?.textContent ?? null,
      freeText: document.querySelector('#free-text-ko').value,
      chips: [...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent),
      finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
    };
  })()`);
  check("VAR02 · 상황 요청 1회", 1, variantCards.calls);
  check("VAR02 · 요청 kind", "situation_variants", variantCards.kind);
  check("VAR02 · 요청 target_groups", JSON.stringify(["pose", "setting"]), JSON.stringify(variantCards.groups));
  check("VAR02 · 인물·의상은 잠금", JSON.stringify(["subject.person", "clothing.white_shirt"]),
    JSON.stringify(variantCards.locked));
  check("VAR02 · 후보 3장", 3, variantCards.count);
  check("VAR02 · 머리글에 표시 불가 1", true, /상황 후보 3개 · 표시 불가 1/.test(variantCards.headline ?? ""));
  check("VAR02 · 후보 순서 유지", "공원에서 걷기,카페에 앉기,개와 함께", variantCards.labels.join(","));
  // The out-of-scope candidate keeps its reason and has no button; the other two apply.
  check("VAR02 · 범위 밖 후보 차단", 1, variantCards.blocked);
  check("VAR02 · 적용 버튼은 2개", 2, variantCards.applyButtons);
  check("VAR02 · 차단 사유 문구", true,
    variantCards.blocks.some((text) => text.includes("이번 요청의 변경 대상이 아닙니다")));
  check("VAR02 · 바뀌는 항목 표시", true,
    variantCards.changes[0].includes("add:배경 · 공원 추가")
    && variantCards.changes[0].includes("remove:배경 · 거리 제거"));
  check("VAR02 · 사전 밖 표현은 원문 유지", true, /우산을 접으며/.test(variantCards.unresolved ?? ""));
  check("VAR02 · 후보 표시만으로 선택 불변", chipsBeforeVariants.join(","), variantCards.chips.join(","));
  check("VAR02 · 후보 표시만으로 원문 불변", "같은 인물과 의상으로 다른 상황", variantCards.freeText);
  check("VAR02 · 후보 표시만으로 최종 prompt 불변", promptBeforeVariants, variantCards.finalPrompt);
  check("VAR02 · 아직 반영 전 안내", true, /아직 선택에 반영하지 않았습니다/.test(variantCards.status ?? ""));
  record("VAR02 후보", JSON.stringify(variantCards));
  await shot(shots, "30-variant-cards.png");

  // 360px: three candidates stack, nothing overflows sideways, the apply button stays
  // inside the card.
  await page.viewport(360, 740, true);
  await sleep(400);
  // Scroll the candidate panel into view so the screenshot (and the measured boxes)
  // show the thing under test rather than the job queue below it.
  await evaluate(`document.querySelector('.prompt-variants')?.scrollIntoView({ block: 'start' })`);
  await sleep(250);
  const narrow = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.prompt-variant')];
    const button = document.querySelector('.prompt-variant button');
    return {
      overflow: document.documentElement.scrollWidth <= innerWidth + 1,
      stacked: nodes.every((node) => node.getBoundingClientRect().width <= innerWidth),
      buttonInside: button ? button.getBoundingClientRect().right <= innerWidth + 1 : null,
      buttonWidth: button ? Math.round(button.getBoundingClientRect().width) : null,
      // At 460px the apply button drops below the sentence instead of squeezing it.
      buttonBelow: button && nodes[0]
        ? button.getBoundingClientRect().top >= nodes[0].querySelector('.prompt-variant__body').getBoundingClientRect().bottom - 1
        : null,
    };
  })()`);
  check("VAR02 360px · 가로 넘침 없음", true, narrow.overflow);
  check("VAR02 360px · 카드가 화면 안", true, narrow.stacked);
  check("VAR02 360px · 적용 버튼 화면 안", true, narrow.buttonInside);
  check("VAR02 360px · 적용 버튼은 문장 아래", true, narrow.buttonBelow);
  record("VAR02 360px", JSON.stringify(narrow));
  await shot(shots, "31-variant-360.png");
  await page.viewport(1280, 900);
  await sleep(300);

  // Apply the second candidate: only the selection moves.
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.prompt-variant')]
      .find((node) => node.querySelector('strong')?.textContent === '카페에 앉기');
    card?.querySelector('button')?.click();
    return !!card;
  })()`);
  await sleep(500);
  const appliedVariant = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.prompt-variant')];
    return {
      chips: [...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent),
      applied: nodes.filter((node) => node.dataset.applied).map((node) => node.querySelector('strong')?.textContent),
      appliedText: document.querySelector('.prompt-variant__applied')?.textContent?.trim() ?? null,
      applyButtons: nodes.filter((node) => node.querySelector('button')).length,
      headline: document.querySelector('.prompt-variants__head strong')?.textContent ?? null,
      undo: document.querySelector('.prompt-variant-undo button')?.textContent?.trim() ?? null,
      undoDisabled: document.querySelector('.prompt-variant-undo button')?.disabled ?? null,
      // A situation apply and a card acceptance are both "the last scene edit", so only
      // one undo line may be on screen.
      cardUndoLines: document.querySelectorAll('.prompt-undo').length,
      status: document.querySelector('.prompt-proposals__status')?.textContent ?? null,
      // The chip order follows the Korean summary rows (표정·행동 before 장소·시간), and
      // the notice is the last status line: the proposal status above it is one too.
      notice: [...document.querySelectorAll('.prompt-builder p[role="status"]')]
        .map((node) => node.textContent).join(' | '),
      freeText: document.querySelector('#free-text-ko').value,
      finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
      // Applying a candidate is a selection edit, so the draft is regenerated from it
      // instead of being left stale — and the final prompt is still untouched.
      draft: document.querySelector('.prompt-draft textarea')?.value ?? null,
    };
  })()`);
  // Chip order follows the Korean summary rows, so 표정·행동 (앉기) renders before 장소 (카페).
  check("VAR02 · 적용 시 장소·행동 교체", "인물,흰 셔츠,앉기,카페", appliedVariant.chips.join(","));
  check("VAR02 · 적용한 카드 표시", "카페에 앉기", appliedVariant.applied.join(","));
  check("VAR02 · 적용 표시 문구", "· 지금 선택에 반영됨", appliedVariant.appliedText);
  // The applied card is not a refused candidate, so the headline is unchanged; it no
  // longer offers 적용.
  check("VAR02 · 적용 후 머리글 유지", "상황 후보 3개 · 표시 불가 1", appliedVariant.headline);
  check("VAR02 · 적용 후 남은 적용 버튼 1개", 1, appliedVariant.applyButtons);
  check("VAR02 · 미반영 표현 안내", true, /사전에 없는 표현 “우산을 접으며”/.test(appliedVariant.notice ?? ""));
  check("VAR02 · 적용해도 원문 불변", "같은 인물과 의상으로 다른 상황", appliedVariant.freeText);
  check("VAR02 · 적용해도 최종 prompt 불변", promptBeforeVariants, appliedVariant.finalPrompt);
  check("VAR02 · 적용 후 초안 재생성", true,
    /in a cafe/.test(appliedVariant.draft ?? "") && !/on a street/.test(appliedVariant.draft ?? ""));
  // Applying unmounts the button that was clicked; focus must land on a control that
  // still exists instead of `document.body`.
  check("VAR02 · 적용 후 포커스 유지", true,
    ["BUTTON"].includes(await evaluate(`document.activeElement?.tagName ?? null`)));
  check("VAR02 · 되돌리기 버튼 노출", "“카페에 앉기” 상황 적용 되돌리기", appliedVariant.undo);
  check("VAR02 · 되돌리기 사용 가능", false, appliedVariant.undoDisabled);
  check("VAR02 · 되돌리기 줄은 하나", 0, appliedVariant.cardUndoLines);
  // The panel status says which candidate is now applied; the notice below carries the
  // "원문과 최종 프롬프트는 그대로" sentence and the unapplied-phrase warning.
  check("VAR02 · 패널 상태 문구",
    "“카페에 앉기” 상황을 적용했습니다. 다른 후보와 비교하거나 바로 되돌릴 수 있습니다.", appliedVariant.status);
  record("VAR02 적용", JSON.stringify(appliedVariant));
  await shot(shots, "32-variant-applied.png");

  // Undo restores the exact pre-apply selection in one step.
  await clickByText(".prompt-variant-undo button", "되돌리기");
  await sleep(500);
  const undoneVariant = await evaluate(`(() => ({
    chips: [...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent),
    undo: document.querySelector('.prompt-variant-undo button')?.textContent ?? null,
    applied: document.querySelectorAll('.prompt-variant[data-applied]').length,
    headline: document.querySelector('.prompt-variants__head strong')?.textContent ?? null,
      notice: [...document.querySelectorAll('.prompt-builder p[role="status"]')]
        .map((node) => node.textContent).join(' | '),
    freeText: document.querySelector('#free-text-ko').value,
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
  }))()`);
  check("VAR02 · 되돌리면 선택 복원", chipsBeforeVariants.join(","), undoneVariant.chips.join(","));
  check("VAR02 · 되돌린 뒤 버튼 사라짐", null, undoneVariant.undo);
  check("VAR02 · 되돌린 뒤 적용 표시 없음", 0, undoneVariant.applied);
  check("VAR02 · 되돌린 뒤 표시 불가 복귀", true,
    /상황 후보 3개 · 표시 불가 1/.test(undoneVariant.headline ?? ""));
  check("VAR02 · 되돌리기 안내 문구", true, /상황 적용을 되돌렸습니다/.test(undoneVariant.notice ?? ""));
  check("VAR02 · 되돌려도 원문 불변", "같은 인물과 의상으로 다른 상황", undoneVariant.freeText);
  check("VAR02 · 되돌려도 최종 prompt 불변", promptBeforeVariants, undoneVariant.finalPrompt);
  record("VAR02 되돌리기", JSON.stringify(undoneVariant));
  await shot(shots, "33-variant-undone.png");

  // Applying, then editing, refuses the undo instead of overwriting the edit.
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.prompt-variant')]
      .find((node) => node.querySelector('strong')?.textContent === '공원에서 걷기');
    card?.querySelector('button')?.click();
    return !!card;
  })()`);
  await sleep(400);
  await typeInto("#free-text-ko", "같은 인물과 의상으로 다른 상황, 비 오는 날");
  await sleep(500);
  const blockedVariantUndo = await evaluate(`(() => {
    const button = document.querySelector('.prompt-variant-undo button');
    return {
      cards: document.querySelectorAll('.prompt-variant').length,
      undo: button?.textContent ?? null,
      disabled: button?.disabled ?? null,
      hint: document.querySelector('.prompt-variant-undo small')?.textContent ?? null,
      chips: [...document.querySelectorAll('.prompt-chip__label')].map((node) => node.textContent),
    };
  })()`);
  check("VAR02 · 편집 후 후보 폐기", 0, blockedVariantUndo.cards);
  check("VAR02 · 편집 후 되돌리기 차단", true, blockedVariantUndo.disabled);
  check("VAR02 · 편집 후 차단 사유", true,
    /되돌릴 수 없습니다/.test(`${blockedVariantUndo.undo} ${blockedVariantUndo.hint}`));
  // The selection the user is looking at is left alone: nothing is reverted blindly.
  check("VAR02 · 편집 후 선택 유지", "인물,흰 셔츠,걷기,공원", blockedVariantUndo.chips.join(","));
  record("VAR02 되돌리기 차단", JSON.stringify(blockedVariantUndo));
  await shot(shots, "34-variant-undo-blocked.png");
}
