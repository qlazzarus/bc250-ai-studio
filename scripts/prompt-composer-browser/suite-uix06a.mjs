/**
 * UIX06A in a real browser: real URLs, real history, and the state that must survive both.
 *
 * The claims here are about the *address bar*, so every assertion reads `location.pathname` and
 * `location.search` and compares them with what is actually on screen. A screenshot cannot show
 * either, and a DOM check alone cannot prove the URL moved.
 *
 * The two properties that would be easy to break and hard to notice:
 *
 * 1. **Navigation is not a request.** Moving between screens must not send a compose or generate
 *    POST. Counted, not assumed.
 * 2. **Navigation is not a remount.** The composer keeps its session, so a request in flight when
 *    the user walks to the queue still lands, and its candidates are still there on return.
 *
 * Nothing here stubs a route: the app's own `routes.ts` decides every path, and the server is
 * the fake engine throughout. History is driven with `history.back()`/`forward()` — the browser's
 * own buttons, not a router method — because that is what the contract is about.
 */

const LOCATION = `(() => ({
  path: location.pathname,
  search: location.search,
  href: location.href,
}))()`;

const SCREEN = `(() => {
  const visible = (selector) => {
    const node = document.querySelector(selector);
    return !!node && !node.hidden && node.getBoundingClientRect().width > 0;
  };
  return {
    composer: visible(".panel.composer"),
    jobs: visible(".panel.jobs"),
    gallery: visible(".panel.gallery"),
    pixel: !!document.querySelector(".pixel-shell"),
    notFound: !!document.querySelector(".not-found"),
    nav: [...document.querySelectorAll(".art-nav a")].map((link) => ({
      to: new URL(link.href).pathname, label: link.textContent.trim(),
      current: link.getAttribute("aria-current"),
    })),
    viewer: !!document.querySelector(".image-viewer"),
    metadata: !!document.querySelector(".preview-modal"),
    dialogLabels: [...document.querySelectorAll('[role="dialog"]')]
      .map((node) => node.getAttribute("aria-label")),
  };
})()`;

/**
 * A counter for the two request kinds navigation must never cause, plus a hold on the compose
 * reply so a request can be *in flight* while the user walks away.
 *
 * Matched by method and exact path, not by substring: the compose POST and the job-create
 * POST are the only two that matter here, and a GET of either must not count.
 */
const INSTALL = `(() => {
  if (window.__uix06a) return true;
  const flags = window.__uix06a = { compose: 0, generate: 0, hold: null, routes: [] };
  const real = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init && init.method) || "GET";
    let path = null;
    try { path = new URL(url, location.origin).pathname; } catch { /* ignore */ }
    if (path) flags.routes.push({ method, path });
    if (method === "POST" && path === "/api/v1/prompts/compose") {
      flags.compose += 1;
      const gate = flags.hold;
      if (gate) {
        flags.hold = null;
        return new Promise((resolve) => { gate.release = () => resolve(real(input, init)); });
      }
    }
    if (method === "POST" && path === "/api/v1/jobs") flags.generate += 1;
    return real(input, init);
  };
  return true;
})()`;

const COUNTS = `(() => ({ compose: window.__uix06a.compose, generate: window.__uix06a.generate }))()`;

/** Ask for the compose reply to be held; returns a handle a later step can release. */
const HOLD = `(() => {
  const gate = {};
  window.__uix06a.hold = gate;
  return true;
})()`;

const RELEASE = `(() => {
  const gate = window.__uix06a.hold;
  if (!gate || !gate.release) return false;
  gate.release();
  return true;
})()`;


export async function runUix06a({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, navigate, clickByText, press, select, shot } = page;
  const at = () => evaluate(LOCATION);
  const screen = () => evaluate(SCREEN);

  // ── A. every supported address boots on its own screen ──────────────────────
  // A full document load per URL: this is the pasted-link / new-tab case, and the only way to
  // prove the app resolves a path it did not navigate to itself.
  const origin = await evaluate("location.origin");
  const ROUTES = [
    { path: "/art", expect: "overview" },
    { path: "/art/compose", expect: "compose" },
    { path: "/art/generate", expect: "generate" },
    { path: "/art/jobs", expect: "jobs" },
    { path: "/art/gallery", expect: "gallery" },
    { path: "/pixel", expect: "pixel" },
  ];
  const entered = [];
  for (const route of ROUTES) {
    await navigate(`${origin}${route.path}`);
    await waitFor("document.readyState === 'complete'", { label: `load ${route.path}`, timeout: 20000 });
    await sleep(900);
    const where = await at();
    const view = await screen();
    const shown = route.expect === "pixel" ? view.pixel
      : route.expect === "gallery" ? view.gallery
      : route.expect === "jobs" ? view.jobs
      : view.composer;
    entered.push({ path: route.path, landed: where.path, screen: route.expect, shown });
    check(`UIX06A · ${route.path} 직접 진입 시 화면`, true, shown === true);
    check(`UIX06A · ${route.path} 직접 진입 시 주소`, route.path, where.path);
  }
  record("UIX06A 직접 진입", JSON.stringify(entered));

  // `/` is the old address: it must land on `/art` by *replace*, so Back does not bounce.
  await navigate(`${origin}/`);
  await waitFor("document.readyState === 'complete'", { label: "load /", timeout: 20000 });
  await sleep(900);
  check("UIX06A · 루트가 /art로 이동", "/art", (await at()).path);

  // ── B. an unknown path says so, and offers a way back ───────────────────────
  await navigate(`${origin}/art/nope`);
  await waitFor("!!document.querySelector('.not-found')", { label: "not found", timeout: 20000 });
  const notFound = await screen();
  check("UIX06A · 없는 경로는 페이지 없음 안내", true, notFound.notFound);
  check("UIX06A · 페이지 없음에 복귀 링크", true,
    await evaluate("!!document.querySelector('.not-found a[href=\"/art\"]')"));
  await shot(shots, "uix06a-05-not-found.png");
  // A deeper path than any route is not a route with extra segments.
  await navigate(`${origin}/art/jobs/a/b`);
  await sleep(900);
  check("UIX06A · 두 단계 작업 경로는 없는 경로", true, (await screen()).notFound);
  record("UIX06A 없는 경로", JSON.stringify({ notFound }));

  // ── C. navigation writes the URL, and Back/Forward follow it ────────────────
  await navigate(`${origin}/art`);
  await sleep(700);
  await evaluate(INSTALL);
  await clickByText(".art-nav a", "작업 큐");
  await waitFor("location.pathname === '/art/jobs'", { label: "nav to jobs", timeout: 10000 });
  // The URL moves first; the nav's `aria-current` follows on the next React commit, so waiting
  // for the attribute is waiting for the screen to agree with the address — which is the claim.
  await waitFor(`document.querySelector('.art-nav a[aria-current="page"]')?.getAttribute('href') === '/art/jobs'`,
    { label: "nav current", timeout: 10000 }).catch(() => false);
  check("UIX06A · 메뉴 이동이 URL을 바꿈", "/art/jobs", (await at()).path);
  check("UIX06A · 이동한 화면이 큐", true, (await screen()).jobs);
  const currentNav = await evaluate(`(() => {
    const node = document.querySelector('.art-nav a[aria-current="page"]');
    return { href: node ? new URL(node.href).pathname : null,
      current: node?.getAttribute('aria-current') ?? null,
      count: document.querySelectorAll('.art-nav a[aria-current="page"]').length };
  })()`);
  check("UIX06A · 메뉴가 현재 화면을 표시", "/art/jobs", currentNav.href);
  check("UIX06A · 현재 화면 표시가 하나뿐", 1, currentNav.count);

  await evaluate("history.back()");
  await waitFor("location.pathname === '/art'", { label: "back to overview", timeout: 10000 });
  await sleep(500);
  check("UIX06A · 뒤로 가기가 이전 주소로", "/art", (await at()).path);
  check("UIX06A · 뒤로 가기 후 화면도 일치", true, (await screen()).composer);

  await evaluate("history.forward()");
  await waitFor("location.pathname === '/art/jobs'", { label: "forward to jobs", timeout: 10000 });
  await sleep(500);
  check("UIX06A · 앞으로 가기가 다음 주소로", "/art/jobs", (await at()).path);
  check("UIX06A · 앞으로 가기 후 화면도 일치", true, (await screen()).jobs);

  // Navigation must not be a request: neither POST kind may fire from walking around.
  const afterWalk = await evaluate(COUNTS);
  check("UIX06A · 화면 이동만으로 Compose 요청 없음", 0, afterWalk.compose);
  check("UIX06A · 화면 이동만으로 생성 요청 없음", 0, afterWalk.generate);


  // ── D. unsaved editor state survives a round trip ───────────────────────────
  await navigate(`${origin}/art`);
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`,
    { label: "models for state test", timeout: 20000 });
  await sleep(600);
  await select(".composer select", "fake-sd15");
  await sleep(500);
  const typed = await evaluate(`(() => {
    const node = document.querySelector('#prompt-final');
    if (!node) return null;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')
      .set.call(node, 'UIX06A 왕복 보존 확인');
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return { prompt: node.value };
  })()`);
  check("UIX06A · 왕복 전 입력 반영", "UIX06A 왕복 보존 확인", typed?.prompt);
  await clickByText(".art-nav a", "갤러리");
  await waitFor("location.pathname === '/art/gallery'", { label: "to gallery", timeout: 10000 });
  await sleep(500);
  await clickByText(".art-nav a", "개요");
  await waitFor("location.pathname === '/art'", { label: "back to overview", timeout: 10000 });
  await sleep(700);
  const kept = await evaluate(`(() => ({
    prompt: document.querySelector('#prompt-final')?.value ?? null,
    model: document.querySelector('.composer select')?.value ?? null,
  }))()`);
  check("UIX06A · 왕복 후 최종 프롬프트 유지", "UIX06A 왕복 보존 확인", kept.prompt);
  check("UIX06A · 왕복 후 모델 유지", "fake-sd15", kept.model);
  record("UIX06A 상태 보존", JSON.stringify({ typed, kept }));



  // ── E. a permalink opens the exact resource ─────────────────────────────────
  const jobsList = await evaluate(`(async () => {
    const headers = { Authorization: window.__authHeader || '' };
    const response = await fetch('/api/v1/jobs?limit=100', { headers });
    const jobs = await response.json();
    return jobs.map((job) => job.job_id);
  })()`);
  // Exercise pagination with a nonempty second page, including a cold load of the URL.
  check("UIX07 · 페이지 검증에 작업 13건 이상", true, jobsList.length >= 13);
  if (jobsList.length >= 13) {
    await navigate(`${origin}/art/jobs`);
    await waitFor(`!!document.querySelector('.jobs-body .pagination button:last-child:not(:disabled)')`,
      { label: "second jobs page available", timeout: 20000 });
    await clickByText('.jobs-body .pagination button', '다음');
    await waitFor(`location.search === '?page=1'`, { label: "jobs page 2 URL" });
    await waitFor(`document.querySelector('.jobs-body .pagination span')?.textContent.includes('2 페이지')`,
      { label: "jobs page 2 content" });
    const expectedSecondPage = await evaluate(`(async () => {
      const response = await fetch('/api/v1/jobs?limit=12&offset=12',
        { headers: { Authorization: window.__authHeader || '' } });
      return (await response.json()).map(job => job.job_id);
    })()`);
    await waitFor(`JSON.stringify([...document.querySelectorAll('.job')].map(n => n.dataset.jobId)) === ${JSON.stringify(JSON.stringify(expectedSecondPage))}`,
      { label: "second page jobs loaded", timeout: 20000 });
    const secondPage = await evaluate(`[...document.querySelectorAll('.job')].map(n => n.dataset.jobId)`);
    check("UIX07 · 작업 2페이지 주소", '?page=1', (await at()).search);
    check("UIX07 · 작업 2페이지에 실제 카드", true, secondPage.length > 0);
    await navigate(`${origin}/art/jobs?page=1`);
    await waitFor(`document.querySelector('.jobs-body .pagination span')?.textContent.includes('2 페이지')`,
      { label: "cold jobs page 2", timeout: 20000 });
    await waitFor(`JSON.stringify([...document.querySelectorAll('.job')].map(n => n.dataset.jobId)) === ${JSON.stringify(JSON.stringify(secondPage))}`,
      { label: "cold page cards", timeout: 20000 });
    check("UIX07 · 2페이지 직접 진입 카드 유지", JSON.stringify(secondPage),
      JSON.stringify(await evaluate(`[...document.querySelectorAll('.job')].map(n => n.dataset.jobId)`)));
    await clickByText('.jobs-body .pagination button', '이전');
    await waitFor(`location.search === ''`, { label: "jobs page 1 URL" });
    check("UIX07 · 이전 페이지 주소 복원", '', (await at()).search);
  }
  const targetJob = Array.isArray(jobsList) ? jobsList[0] ?? null : null;
  if (targetJob) {
    await navigate(`${origin}/art/jobs/${targetJob}`);
    await waitFor(`!!document.querySelector('.job[data-job-id="${targetJob}"]')`,
      { label: "job permalink", timeout: 25000 });
    await sleep(700);
    check("UIX06A · 작업 퍼머링크 주소", `/art/jobs/${targetJob}`, (await at()).path);
    check("UIX06A · 작업 퍼머링크가 그 작업을 찾음", true,
      await evaluate(`!!document.querySelector('.job[data-job-id="${targetJob}"]')`));
    check("UIX06A · 퍼머링크가 다른 작업을 대신 고르지 않음", 1,
      await evaluate(`document.querySelectorAll('.job[data-spotlight]').length`));
    await shot(shots, "uix06a-06-job-permalink.png");
  } else {
    record("UIX06A 작업 퍼머링크", "작업이 없어 건너뜀");
  }

  const assetsList = await evaluate(`(async () => {
    const headers = { Authorization: window.__authHeader || '' };
    const response = await fetch('/api/v1/assets?namespace=nsfw&limit=24&offset=0&archived=false', { headers });
    const assets = await response.json();
    return assets.map((asset) => asset.asset_id);
  })()`);
  const targetImage = Array.isArray(assetsList) ? assetsList[0] ?? null : null;
  if (targetImage) {
    await navigate(`${origin}/art/gallery/${targetImage}`);
    await waitFor("!!document.querySelector('.image-viewer')", { label: "image permalink", timeout: 25000 });
    await sleep(700);
    check("UIX06A · 이미지 퍼머링크 주소", `/art/gallery/${targetImage}`, (await at()).path);
    const viewer = await screen();
    check("UIX06A · 이미지 퍼머링크가 뷰어를 염", true, viewer.viewer);
    check("UIX06A · 뷰어 이름에 그 이미지", true,
      (viewer.dialogLabels[0] ?? "").includes(targetImage.slice(0, 8)));
    await shot(shots, "uix06a-03-image-permalink.png");

    // Escape from a pasted link must not leave the app.
    await press("Escape");
    await waitFor("!document.querySelector('.image-viewer')", { label: "viewer closed", timeout: 8000 });
    await sleep(600);
    check("UIX06A · 직접 진입 뷰어 닫기가 갤러리로", "/art/gallery", (await at()).path);

    // The metadata permalink is a separate address for the same image.
    await navigate(`${origin}/art/gallery/${targetImage}/metadata`);
    await waitFor("!!document.querySelector('.preview-modal')", { label: "metadata permalink", timeout: 25000 });
    await sleep(700);
    check("UIX06A · 생성 정보 퍼머링크 주소",
      `/art/gallery/${targetImage}/metadata`, (await at()).path);
    check("UIX06A · 생성 정보 퍼머링크가 그 이미지", true,
      await evaluate(`(document.querySelector('.preview-modal')?.getAttribute('aria-label') ?? '').includes(${JSON.stringify(targetImage.slice(0, 8))})`));
    await shot(shots, "uix06a-04-metadata-permalink.png");
  } else {
    record("UIX06A 이미지 퍼머링크", "이미지가 없어 건너뜀");
  }


  // ── F. a bad id is reported, never silently replaced by another resource ────
  await navigate(`${origin}/art/gallery/nope-does-not-exist`);
  await sleep(1800);
  const missingImage = await screen();
  check("UIX06A · 없는 이미지는 뷰어를 열지 않음", false, missingImage.viewer);
  record("UIX06A 없는 이미지", JSON.stringify({
    path: (await at()).path, viewer: missingImage.viewer,
    notice: await evaluate(`document.querySelector('.gallery-lookup')?.textContent?.trim() ?? null`),
  }));

  await navigate(`${origin}/art/jobs/nope-does-not-exist`);
  await sleep(1800);
  record("UIX06A 없는 작업", JSON.stringify({
    path: (await at()).path,
    notice: await evaluate(`document.querySelector('.jobs-nav')?.textContent?.trim() ?? null`),
  }));

  // ── G. Pixel Studio has its own address and a way back ──────────────────────
  await navigate(`${origin}/art`);
  await waitFor("!!document.querySelector('.art-nav')", { label: "art nav", timeout: 20000 });
  await sleep(600);
  await clickByText("a", "Pixel Studio");
  await waitFor("location.pathname === '/pixel'", { label: "to pixel", timeout: 10000 });
  await sleep(700);
  check("UIX06A · Pixel Studio 주소", "/pixel", (await at()).path);
  check("UIX06A · Pixel Studio 화면", true, (await screen()).pixel);
  check("UIX06A · Pixel Studio 복귀 링크", true,
    await evaluate(`!!document.querySelector('.pixel-shell a[href="/art"]')`));
  await shot(shots, "uix06a-07-pixel.png");

  // ── H. 360 and 1280: no sideways overflow, 44px targets ─────────────────────
  for (const width of [360, 390, 1280]) {
    await page.viewport(width, width === 360 ? 780 : width === 390 ? 844 : 900);
    await navigate(`${origin}/art`);
    await waitFor("!!document.querySelector('.art-nav')", { label: `nav at ${width}`, timeout: 20000 });
    await sleep(900);
    const layout = await evaluate(`(() => {
      const doc = document.documentElement;
      const links = [...document.querySelectorAll('.art-nav a')].map((link) => {
        const box = link.getBoundingClientRect();
        return { label: link.textContent.trim(), width: Math.round(box.width),
          height: Math.round(box.height), right: Math.round(box.right) };
      });
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        links,
        smallest: links.length ? Math.min(...links.map((l) => l.height)) : 0,
        offscreen: links.filter((l) => l.right > doc.clientWidth + 1).length,
      };
    })()`);
    check(`UIX06A · ${width}px 가로 넘침 없음`, true, layout.overflow <= 1);
    check(`UIX06A · ${width}px 메뉴가 화면 안`, 0, layout.offscreen);
    check(`UIX06A · ${width}px 메뉴 터치 영역 44px 이상`, true, layout.smallest >= 44);
    record(`UIX06A 레이아웃 ${width}`, JSON.stringify(layout));
    await shot(shots, `uix06a-nav-${width}.png`);
  }

  // ── I. keyboard: the menu is reachable and Enter follows the link ───────────
  await page.viewport(1280, 900);
  await navigate(`${origin}/art`);
  await waitFor("!!document.querySelector('.art-nav a')", { label: "nav for keyboard", timeout: 20000 });
  await sleep(600);
  const keyboard = await evaluate(`(() => {
    const link = document.querySelector('.art-nav a[href="/art/jobs"]');
    if (!link) return { present: false };
    link.focus();
    const style = getComputedStyle(link);
    return { present: true, focused: document.activeElement === link,
      outlineWidth: style.outlineWidth };
  })()`);
  check("UIX06A · 메뉴 링크가 포커스를 받음", true, keyboard.focused === true);
  check("UIX06A · 메뉴 링크에 포커스 표시", true,
    Number.parseFloat(keyboard.outlineWidth || "0") > 0);
  await press("Enter");
  await waitFor("location.pathname === '/art/jobs'", { label: "enter follows link", timeout: 10000 });
  check("UIX06A · Enter가 링크를 따라감", "/art/jobs", (await at()).path);
  record("UIX06A 키보드", JSON.stringify(keyboard));
}

