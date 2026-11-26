/**
 * UIX06 in a real browser: the two gallery dialogs' focus contract, and reuse/archive return paths.
 *
 * Every focus claim here reads `document.activeElement` — not a CSS outline and not a screenshot.
 * That is the difference between "the element could be focused" and "the browser put focus there",
 * and the whole point of this block is the second one.
 *
 * No new API and no new stub shape: the only intercepted call is `POST /api/v1/assets/<id>/archive`,
 * matched by method *and* the exact asset id, so a different image's archive cannot consume the
 * one-shot failure. A successful archive is the real server, because the claim is about what the
 * gallery does when a card really disappears.
 */

/**
 * Focus probe. Returns what the browser says is focused, in a shape a check can compare:
 * which dialog (if any) owns it, its tag, its label and its id.
 */
const ACTIVE = `(() => {
  const node = document.activeElement;
  if (!node || node === document.body) return { on: "body" };
  const dialog = node.closest('[role="dialog"]');
  return {
    on: dialog ? "dialog" : "page",
    dialogLabel: dialog ? dialog.getAttribute("aria-label") : null,
    tag: node.tagName,
    label: node.getAttribute("aria-label"),
    id: node.id || null,
    text: (node.textContent || "").trim().slice(0, 40),
    assetId: node.getAttribute("data-asset-id"),
  };
})()`;

/** The dialog's own description, so a check can name the image the way a screen reader would. */
const DIALOGS = `(() => [...document.querySelectorAll('[role="dialog"]')].map((node) => ({
  label: node.getAttribute("aria-label"),
  modal: node.getAttribute("aria-modal"),
  visible: node.getBoundingClientRect().width > 0,
})))()`;

export async function runUix06({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, clickByText, tab, press } = page;
  const active = () => evaluate(ACTIVE);
  const dialogs = () => evaluate(DIALOGS);

  // ── A. the gallery has images to open ───────────────────────────────────────
  // Earlier blocks have generated assets already; this one needs three so "open the second card"
  // is meaningful and the viewer's previous/next have somewhere to go.
  await waitFor(`document.querySelectorAll('.asset').length >= 3`,
    { label: "three gallery cards", timeout: 30000 });
  const gallery = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.asset')];
    return cards.slice(0, 4).map((card) => {
      const open = card.querySelector('.asset-image');
      const info = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '정보');
      return {
        openLabel: open?.getAttribute('aria-label') ?? null,
        infoLabel: info?.getAttribute('aria-label') ?? null,
      };
    });
  })()`);
  // The accessible name must say which image, not just "이미지 보기" four times over.
  check("UIX06 · 보기 버튼 이름에 이미지 식별자 포함", true,
    gallery.every((card) => /^이미지 보기 · [0-9a-f]{8}$/.test(card.openLabel ?? "")));
  check("UIX06 · 정보 버튼 이름에 이미지 식별자 포함", true,
    gallery.every((card) => /^정보 · [0-9a-f]{8}$/.test(card.infoLabel ?? "")));
  check("UIX06 · 카드마다 서로 다른 이름", gallery.length,
    new Set(gallery.map((card) => card.openLabel)).size);
  record("UIX06 갤러리", JSON.stringify(gallery.slice(0, 2)));
  await page.shot(shots, "uix06-01-gallery.png");

  // ── B. the viewer: name, initial focus, trap, Escape return ─────────────────
  // Open the *second* card by clicking it, and remember the label it actually had at that
  // moment. The gallery polls, so an index captured earlier may name a different card by the
  // time the dialog closes; the id in the label is the stable comparison.
  const viewerOpener = await evaluate(`(() => {
    const open = document.querySelectorAll('.asset-image')[1];
    if (!open) return null;
    const label = open.getAttribute('aria-label');
    open.click();
    return label;
  })()`);
  await waitFor(`!!document.querySelector('.image-viewer')`, { label: "viewer open", timeout: 10000 });
  await sleep(400);
  const opened = await dialogs();
  check("UIX06 · 뷰어 대화상자가 하나 열림", 1, opened.length);
  check("UIX06 · 뷰어 이름에 이미지 식별자 포함", true,
    /^이미지 보기 · [0-9a-f]{8}$/.test(opened[0]?.label ?? ""));
  check("UIX06 · 뷰어가 모달로 표시됨", "true", opened[0]?.modal);
  // Initial focus must be inside the dialog, not left on the page behind it.
  const first = await active();
  check("UIX06 · 열면 포커스가 뷰어 안에 있음", "dialog", first.on);
  record("UIX06 뷰어 초기 포커스", JSON.stringify(first));
  await page.shot(shots, "uix06-02-viewer.png");

  // Tab through every stop and confirm focus never leaves. The viewer has three stops
  // (close, previous, next); a fourth Tab must be back inside, not on the page.
  const tour = [];
  for (let step = 0; step < 5; step += 1) {
    await tab(false);
    await sleep(120);
    tour.push((await active()).on);
  }
  check("UIX06 · Tab이 뷰어 밖으로 나가지 않음", true, tour.every((where) => where === "dialog"));
  record("UIX06 뷰어 Tab 순회", JSON.stringify(tour));

  const back = [];
  for (let step = 0; step < 5; step += 1) {
    await tab(true);
    await sleep(120);
    back.push((await active()).on);
  }
  check("UIX06 · Shift+Tab도 뷰어 안에 머묾", true, back.every((where) => where === "dialog"));

  // Escape closes and returns to the card that opened it — the second card, by name.
  await press("Escape", "Escape", 27);
  await waitFor(`!document.querySelector('.image-viewer')`, { label: "viewer closed", timeout: 5000 });
  await sleep(400);
  const afterEscape = await active();
  check("UIX06 · Escape로 뷰어가 닫힘", 0, (await dialogs()).length);
  check("UIX06 · Escape 후 원래 카드로 포커스 복귀", viewerOpener, afterEscape.label);
  check("UIX06 · 복귀 포커스가 페이지에 있음", "page", afterEscape.on);

  // The close button is a separate path and must return to the same place.
  const reopenLabel = await evaluate(`(() => {
    const open = document.querySelectorAll('.asset-image')[1];
    if (!open) return null;
    const label = open.getAttribute('aria-label');
    open.click();
    return label;
  })()`);
  await waitFor(`!!document.querySelector('.image-viewer')`, { label: "viewer reopen", timeout: 10000 });
  await sleep(300);
  await clickByText(".viewer-close", "×").catch(() => false);
  await waitFor(`!document.querySelector('.image-viewer')`, { label: "viewer closed by button", timeout: 5000 });
  await sleep(400);
  const afterButton = await active();
  check("UIX06 · 닫기 버튼도 원래 카드로 포커스 복귀", reopenLabel, afterButton.label);

  // ── C. the metadata dialog: name, initial focus, trap, Escape return ────────
  // Returns the info button's label from the card it actually clicked, rather than an index
  // captured earlier: the gallery is refreshed by polling, and a new asset can appear at the
  // front, so `gallery[1]` would then name a different card than the one opened. Reading the
  // label at click time is the id-based comparison the contract asks for.
  const openInfo = async (index) => {
    const label = await evaluate(`(() => {
      const card = document.querySelectorAll('.asset')[${index}];
      if (!card) return null;
      const info = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '정보');
      if (!info) return null;
      const label = info.getAttribute('aria-label');
      info.click();
      return label;
    })()`);
    await waitFor(`!!document.querySelector('.preview-modal')`, { label: "metadata open", timeout: 15000 });
    await sleep(400);
    return label;
  };

  const metaInfoLabel = await openInfo(1);
  const metaDialogs = await dialogs();
  check("UIX06 · 메타데이터 대화상자가 하나 열림", 1, metaDialogs.length);
  check("UIX06 · 메타데이터 이름에 이미지 식별자 포함", true,
    /^생성 이미지 상세 · [0-9a-f]{8}$/.test(metaDialogs[0]?.label ?? ""));
  check("UIX06 · 메타데이터도 모달로 표시됨", "true", metaDialogs[0]?.modal);
  // The dialog states the asset id, which is what every other view names it by.
  const shownId = await evaluate(`document.querySelector('.preview-modal [data-asset-id]')
    ?.getAttribute('data-asset-id') ?? null`);
  check("UIX06 · 대화상자가 이미지 ID를 표시", true, /^[0-9a-f]{8}/.test(shownId ?? ""));
  const metaFirst = await active();
  check("UIX06 · 열면 포커스가 메타데이터 안에 있음", "dialog", metaFirst.on);
  check("UIX06 · 초기 포커스가 재사용 버튼", "이 설정으로 다시 생성", metaFirst.text);
  await page.shot(shots, "uix06-03-metadata.png");

  const metaTour = [];
  for (let step = 0; step < 6; step += 1) {
    await tab(false);
    await sleep(120);
    metaTour.push((await active()).on);
  }
  check("UIX06 · Tab이 메타데이터 밖으로 나가지 않음", true,
    metaTour.every((where) => where === "dialog"));
  record("UIX06 메타데이터 Tab 순회", JSON.stringify(metaTour));

  const metaBack = [];
  for (let step = 0; step < 6; step += 1) {
    await tab(true);
    await sleep(120);
    metaBack.push((await active()).on);
  }
  check("UIX06 · Shift+Tab도 메타데이터 안에 머묾", true,
    metaBack.every((where) => where === "dialog"));

  await press("Escape", "Escape", 27);
  await waitFor(`!document.querySelector('.preview-modal')`, { label: "metadata closed", timeout: 5000 });
  await sleep(400);
  const metaAfterEscape = await active();
  check("UIX06 · Escape로 메타데이터가 닫힘", 0, (await dialogs()).length);
  check("UIX06 · Escape 후 정보 버튼으로 포커스 복귀", metaInfoLabel, metaAfterEscape.label);

  // ── D. reuse: cancelled overwrite keeps the dialog, success moves to the prompt ──
  // Type something different into the final prompt first, so reuse has a real overwrite to
  // confirm. `window.confirm` is answered by the driver's dialog handler.
  await evaluate(`(() => {
    const node = document.querySelector('#prompt-final');
    const proto = Object.getPrototypeOf(node);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, 'uix06 typed over');
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await openInfo(1);
  await evaluate(`(() => { window.__confirmCalls = 0; return true; })()`);
  // Cancel the overwrite: the dialog must stay open and focus must stay on the reuse button.
  await evaluate(`(() => {
    const real = window.confirm;
    window.confirm = () => { window.__confirmCalls += 1; return false; };
    window.__restoreConfirm = real;
    return true;
  })()`);
  await clickByText(".preview-modal .generate", "이 설정으로 다시 생성").catch(() => false);
  await sleep(600);
  const afterCancel = await active();
  check("UIX06 · 덮어쓰기 확인이 실제로 떴음", 1, await evaluate("window.__confirmCalls"));
  check("UIX06 · 취소하면 메타데이터가 유지됨", 1, (await dialogs()).length);
  check("UIX06 · 취소 후 포커스가 재사용 버튼으로 복귀", "이 설정으로 다시 생성", afterCancel.text);
  const keptPrompt = await evaluate("document.querySelector('#prompt-final')?.value ?? null");
  check("UIX06 · 취소하면 기존 입력이 유지됨", "uix06 typed over", keptPrompt);

  // Now accept it: the dialog closes and focus lands in the final prompt, which was rewritten.
  await evaluate(`(() => {
    window.confirm = () => { window.__confirmCalls += 1; return true; };
    return true;
  })()`);
  const promptBefore = await evaluate("document.querySelector('#prompt-final')?.value ?? null");
  await clickByText(".preview-modal .generate", "이 설정으로 다시 생성").catch(() => false);
  await waitFor(`!document.querySelector('.preview-modal')`, { label: "reuse closed", timeout: 10000 });
  await sleep(500);
  const afterReuse = await active();
  const restored = await evaluate("document.querySelector('#prompt-final')?.value ?? null");
  check("UIX06 · 재사용 성공으로 대화상자가 닫힘", 0, (await dialogs()).length);
  check("UIX06 · 재사용이 최종 프롬프트를 바꿈", true, restored !== promptBefore && Boolean(restored));
  check("UIX06 · 재사용 후 포커스가 최종 프롬프트로 이동", "prompt-final", afterReuse.id);
  record("UIX06 재사용", JSON.stringify({ before: promptBefore?.slice(0, 30),
    after: restored?.slice(0, 30), focus: afterReuse }));
  await page.shot(shots, "uix06-04-reuse.png");
  await evaluate(`(() => { window.confirm = window.__restoreConfirm; return true; })()`);

  // ── E. archive: a failure keeps the dialog, a success returns to the heading ──
  // The stub matches method *and* the exact asset id, so no other card's archive can consume it.
  await openInfo(0);
  const targetId = await evaluate(`document.querySelector('.preview-modal [data-asset-id]')
    ?.getAttribute('data-asset-id') ?? null`);
  await evaluate(`(() => {
    const real = window.fetch;
    const target = ${JSON.stringify(targetId)};
    window.__archiveStub = { calls: 0, target };
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init && init.method) || 'GET';
      if (method === 'POST' && url.endsWith('/api/v1/assets/' + target + '/archive')) {
        window.__archiveStub.calls += 1;
        if (window.__archiveStub.calls === 1) {
          return Promise.resolve(new Response(JSON.stringify({ detail: '보관 실패(테스트)' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }));
        }
      }
      return real(input, init);
    };
    return true;
  })()`);
  await clickByText(".preview-modal .metadata-actions button", "보관").catch(() => false);
  await sleep(1200);
  const afterArchiveFail = await evaluate(`(() => {
    const failure = document.querySelector('.preview-modal .modal-failure');
    return {
      open: !!document.querySelector('.preview-modal'),
      text: failure?.textContent.trim() ?? null,
      role: failure?.getAttribute('role') ?? null,
      stillListed: !!document.querySelector('.asset [data-asset-id="' + ${JSON.stringify(targetId)} + '"]')
        || document.body.textContent.includes(${JSON.stringify(targetId.slice(0, 8))}),
      calls: window.__archiveStub?.calls ?? 0,
    };
  })()`);
  check("UIX06 · 보관 실패가 대화상자 안에 표시됨", true,
    Boolean(afterArchiveFail.text?.includes("보관 실패")));
  check("UIX06 · 실패 문구가 경고로 읽힘", "alert", afterArchiveFail.role);
  check("UIX06 · 보관 실패 후에도 대화상자 유지", true, afterArchiveFail.open);
  check("UIX06 · 보관 실패는 한 번만 요청", 1, afterArchiveFail.calls);
  await page.shot(shots, "uix06-05-archive-failure.png");

  // The second attempt is the real server: the card disappears and focus goes to the heading.
  await clickByText(".preview-modal .metadata-actions button", "보관").catch(() => false);
  await waitFor(`!document.querySelector('.preview-modal')`, { label: "archive closed", timeout: 15000 });
  await sleep(1200);
  const afterArchiveOk = await evaluate(`(() => {
    const heading = document.querySelector('.gallery .section-title h2');
    return {
      open: !!document.querySelector('.preview-modal'),
      focusTag: document.activeElement?.tagName ?? null,
      focusText: (document.activeElement?.textContent ?? '').trim(),
      isHeading: document.activeElement === heading,
      stillThere: [...document.querySelectorAll('.asset small')]
        .some((node) => node.textContent.includes(${JSON.stringify(targetId.slice(0, 8))})),
    };
  })()`);
  check("UIX06 · 보관 성공으로 대화상자가 닫힘", false, afterArchiveOk.open);
  check("UIX06 · 보관 성공 후 포커스가 갤러리 제목", true, afterArchiveOk.isHeading);
  check("UIX06 · 보관한 카드가 목록에서 사라짐", false, afterArchiveOk.stillThere);
  record("UIX06 보관", JSON.stringify(afterArchiveOk));

  // ── F. 360 and 1280: the same fixture at both widths ────────────────────────
  // Both widths run against the same gallery and the same modal contents, so a difference
  // between the shots is layout, not data. Each state is re-opened by clicking the card, and
  // the modal is closed before the next width so nothing leaks across.
  //
  // The gallery has to be on screen first. Step (4) below accepts a reuse, which navigates to
  // `/art/generate` — so without this the second width would measure a hidden gallery and every
  // card would report a zero-size button. Navigating back is part of establishing the state,
  // not a way to make the numbers pass.
  for (const [width, height, label] of [[360, 800, "360"], [1280, 900, "1280"]]) {
    await page.viewport(width, height, width < 500);
    await clickByText(".art-nav a", "갤러리").catch(() => false);
    await waitFor(`location.pathname === '/art/gallery'`, { label: `${label} gallery`, timeout: 10000 })
      .catch(() => false);
    await waitFor(`document.querySelectorAll('.asset').length >= 3`,
      { label: `${label} cards`, timeout: 15000 }).catch(() => false);
    await sleep(500);

    // (1) the gallery itself.
    const galleryLayout = await evaluate(`(() => {
      const doc = document.documentElement;
      const cards = [...document.querySelectorAll('.asset')];
      const openers = [...document.querySelectorAll('.asset-image')];
      const infos = [...document.querySelectorAll('.asset-footer button')];
      const box = (node) => { const b = node.getBoundingClientRect(); return b; };
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        cards: cards.length,
        cardOverflow: cards.filter((card) => card.scrollWidth - card.clientWidth > 1).length,
        openersOutside: openers.filter((node) => {
          const b = box(node);
          return b.right > doc.clientWidth + 1 || b.left < -1;
        }).length,
        smallTargets: infos.filter((node) => box(node).height < 44).length,
        labelled: openers.every((node) => (node.getAttribute('aria-label') || '').includes('·')),
      };
    })()`);
    check(`UIX06 · ${label} 갤러리에서 가로 넘침 없음`, true, galleryLayout.overflow <= 1);
    check(`UIX06 · ${label} 카드가 화면 안에 있음`, 0, galleryLayout.openersOutside);
    check(`UIX06 · ${label} 카드 내부 넘침 없음`, 0, galleryLayout.cardOverflow);
    check(`UIX06 · ${label} 정보 버튼이 44px 이상`, 0, galleryLayout.smallTargets);
    check(`UIX06 · ${label} 모든 보기 버튼에 식별자 포함`, true, galleryLayout.labelled);
    record(`UIX06 ${label} 갤러리`, JSON.stringify(galleryLayout));
    await page.shot(shots, `uix06-06-gallery-${label}.png`);

    // (2) the viewer.
    await evaluate(`document.querySelectorAll('.asset-image')[0]?.click(); true`);
    await waitFor(`!!document.querySelector('.image-viewer')`, { label: `${label} viewer`, timeout: 10000 });
    await sleep(500);
    const viewerLayout = await evaluate(`(() => {
      const doc = document.documentElement;
      const dialog = document.querySelector('.image-viewer');
      const box = dialog ? dialog.getBoundingClientRect() : null;
      const buttons = [...(dialog?.querySelectorAll('button') ?? [])];
      return {
        inside: !!box && box.right <= doc.clientWidth + 1 && box.left >= -1,
        overflow: doc.scrollWidth - doc.clientWidth,
        dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : null,
        smallTargets: buttons.filter((node) => node.getBoundingClientRect().height < 44).length,
        label: dialog?.getAttribute('aria-label') ?? null,
        labelled: (dialog?.getAttribute('aria-label') ?? '').includes('·'),
      };
    })()`);
    check(`UIX06 · ${label} 뷰어가 화면 안`, true, viewerLayout.inside);
    check(`UIX06 · ${label} 뷰어에서 가로 넘침 없음`, true, viewerLayout.overflow <= 1);
    check(`UIX06 · ${label} 뷰어 내부 넘침 없음`, 0, viewerLayout.dialogOverflow);
    check(`UIX06 · ${label} 뷰어 버튼이 44px 이상`, 0, viewerLayout.smallTargets);
    check(`UIX06 · ${label} 뷰어 이름에 식별자 포함`, true, viewerLayout.labelled);
    record(`UIX06 ${label} 뷰어`, JSON.stringify(viewerLayout));
    await page.shot(shots, `uix06-07-viewer-${label}.png`);
    await press("Escape", "Escape", 27);
    await waitFor(`!document.querySelector('.image-viewer')`, { label: `${label} viewer closed`, timeout: 5000 });
    await sleep(300);

    // (3) the metadata dialog.
    await openInfo(0);
    const metaLayout = await evaluate(`(() => {
      const doc = document.documentElement;
      const dialog = document.querySelector('.preview-modal');
      const box = dialog ? dialog.getBoundingClientRect() : null;
      const buttons = [...(dialog?.querySelectorAll('button') ?? [])];
      const focus = document.activeElement;
      return {
        inside: !!box && box.right <= doc.clientWidth + 1 && box.left >= -1,
        overflow: doc.scrollWidth - doc.clientWidth,
        dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : null,
        smallTargets: buttons.filter((node) => node.getBoundingClientRect().height < 44).length,
        labelled: (dialog?.getAttribute('aria-label') ?? '').includes('·'),
        focusInside: !!dialog && dialog.contains(focus) && focus !== dialog,
      };
    })()`);
    check(`UIX06 · ${label} 메타데이터가 화면 안`, true, metaLayout.inside);
    check(`UIX06 · ${label} 메타데이터에서 가로 넘침 없음`, true, metaLayout.overflow <= 1);
    check(`UIX06 · ${label} 메타데이터 내부 넘침 없음`, 0, metaLayout.dialogOverflow);
    check(`UIX06 · ${label} 메타데이터 버튼이 44px 이상`, 0, metaLayout.smallTargets);
    check(`UIX06 · ${label} 메타데이터 이름에 식별자 포함`, true, metaLayout.labelled);
    check(`UIX06 · ${label} 초기 포커스가 대화상자 안`, true, metaLayout.focusInside);
    record(`UIX06 ${label} 메타데이터`, JSON.stringify(metaLayout));
    await page.shot(shots, `uix06-08-metadata-${label}.png`);

    // (4) the reuse result: focus in the final prompt, which is where the restore points.
    await evaluate(`(() => {
      window.__confirmCalls = 0;
      window.confirm = () => { window.__confirmCalls += 1; return true; };
      return true;
    })()`);
    await clickByText(".preview-modal .generate", "이 설정으로 다시 생성").catch(() => false);
    await waitFor(`!document.querySelector('.preview-modal')`, { label: `${label} reuse closed`, timeout: 10000 });
    await sleep(600);
    const reuseLayout = await evaluate(`(() => {
      const doc = document.documentElement;
      const prompt = document.querySelector('#prompt-final');
      const box = prompt ? prompt.getBoundingClientRect() : null;
      return {
        focusId: document.activeElement?.id ?? null,
        focusInPrompt: document.activeElement === prompt,
        value: prompt?.value ?? null,
        inside: !!box && box.right <= doc.clientWidth + 1 && box.left >= -1,
        overflow: doc.scrollWidth - doc.clientWidth,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
      };
    })()`);
    check(`UIX06 · ${label} 재사용 후 포커스가 최종 입력`, "prompt-final", reuseLayout.focusId);
    check(`UIX06 · ${label} 재사용 후 대화상자가 닫힘`, 0, reuseLayout.dialogs);
    check(`UIX06 · ${label} 복원된 입력이 화면 안`, true, reuseLayout.inside);
    check(`UIX06 · ${label} 재사용 후 가로 넘침 없음`, true, reuseLayout.overflow <= 1);
    record(`UIX06 ${label} 재사용`, JSON.stringify(reuseLayout));
    await evaluate(`document.querySelector('#prompt-final')?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    await page.shot(shots, `uix06-09-reuse-${label}.png`);
  }
}

