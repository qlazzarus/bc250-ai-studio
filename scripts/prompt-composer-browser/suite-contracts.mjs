// Apply, overwrite-cancel, saved restore, family switch and capability failure
// (U05/U06/U08/U10). Uses only local fetch interception on this page.
import { setQueue } from "./ui.mjs";

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
}
