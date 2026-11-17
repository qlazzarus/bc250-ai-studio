// Apply, overwrite-cancel, saved restore, family switch and capability failure
// (U05/U06/U08/U10). Uses only local fetch interception on this page.
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
  await click("button.generate");
  await waitFor(`document.querySelectorAll('.job').length >= 1`, { timeout: 25000, label: "job" });
  await sleep(2500);
  record("생성 결과 상태", await evaluate(`document.querySelector('.job .badge')?.textContent`));
  check("직접 생성 · 작업 표시", true, await evaluate(`document.querySelectorAll('.job').length >= 1`));
  await shot(shots, "11-job.png");

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

  // ── L2. family switch keeps a valid prompt and drops the stale draft ─────
  await select(".composer select", "fake-flux2");
  await sleep(500);
  const switched = await evaluate(`(() => ({
    prompt: document.querySelector('.composer textarea[rows="5"]').value.length,
    hasResult: !!document.querySelector('.prompt-result'),
    regenerate: [...document.querySelectorAll('.prompt-scene button, .prompt-result button')]
      .some((b) => b.textContent.includes('초안 만들기') || b.textContent.includes('다시 만들기')),
    applyDisabled: (() => {
      const node = [...document.querySelectorAll('.prompt-result button')].find((b) => b.textContent.includes('적용'));
      return node ? node.disabled : null;
    })(),
  }))()`);
  check("계열 전환 · 최종 프롬프트 유지", true, switched.prompt > 0);
  check("계열 전환 · 재생성 경로 제공", true, switched.regenerate || !switched.hasResult);
  record("계열 전환 상태", JSON.stringify(switched));
  await shot(shots, "13-family-switch.png");

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
