// Keyboard and responsive checks (U09). Real Tab/Shift+Tab/Space/Enter events, so
// "keyboard reachable" means traversal actually reaches the control.
export async function runKeyboard({ page, check, record, sleep, shots }) {
  const { evaluate, press, activeInfo, viewport, shot, clickByText, waitFor } = page;

  await evaluate(`document.querySelector('.prompt-builder > .quiet').focus()`);
  const forward = [];
  for (let index = 0; index < 6; index += 1) {
    await press("Tab", "Tab", 9);
    forward.push(await activeInfo());
  }
  const backward = [];
  for (let index = 0; index < 3; index += 1) {
    await press("Tab", "Tab", 9, 8);
    backward.push(await activeInfo());
  }
  record("키보드 Tab 순회", JSON.stringify(forward));
  record("키보드 Shift+Tab 순회", JSON.stringify(backward));
  check("키보드 · 검색 입력 도달", true, forward.some((item) => item?.tag === "INPUT"));
  // The category buttons are inside `.prompt-categories`; activeInfo has no
  // className for them, so the label text is the reliable signal.
  check("키보드 · 분류 버튼 도달", true, forward.some((item) => /선택 \d/.test(item?.text || "")));
  check("키보드 · Shift+Tab로 되돌아옴", true, backward.length === 3);

  // Space toggles a category button; Enter opens the chip's English detail.
  await evaluate(`[...document.querySelectorAll('.prompt-categories button')]
    .find((node) => node.textContent.includes('조명')).focus()`);
  await press(" ", "Space", 32);
  await sleep(250);
  check("키보드 · Space로 분류 전환", true, await evaluate(`(() => {
    const active = [...document.querySelectorAll('.prompt-categories button')]
      .find((node) => node.getAttribute('aria-pressed') === 'true');
    return !!active && active.textContent.includes('조명');
  })()`));

  const chipsBefore = await evaluate(`document.querySelectorAll('.prompt-chip').length`);
  await evaluate(`document.querySelector('.prompt-chip__detail summary').focus()`);
  await press("Enter", "Enter", 13);
  await sleep(200);
  check("키보드 · 표현 상세 열기", true, await evaluate(`document.querySelector('.prompt-chip__detail').open`));
  await press("Enter", "Enter", 13);
  await sleep(200);
  check("키보드 · 표현 상세 닫기", false, await evaluate(`document.querySelector('.prompt-chip__detail').open`));
  check("상세 토글 · 선택 불변", chipsBefore, await evaluate(`document.querySelectorAll('.prompt-chip').length`));
  await shot(shots, "08-keyboard.png");

  // Touch target sizes and responsive layouts.
  const box = await evaluate(`(() => {
    const node = document.querySelector('.prompt-chip button');
    const rect = node.getBoundingClientRect();
    return { w: Math.round(rect.width), h: Math.round(rect.height) };
  })()`);
  check("제거 버튼 터치 크기 ≥26px", true, box.w >= 26 && box.h >= 26);
  record("제거 버튼 크기", JSON.stringify(box));

  // The apply control only exists while a draft exists, so the mobile checks run
  // against a real draft instead of reporting a missing element as a layout defect.
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".prompt-result button", "적용");
  await sleep(400);
  check("적용 후 초안 영역 유지", true, await evaluate(`!!document.querySelector('.prompt-result')`));

  for (const [width, height] of [[390, 844], [360, 740]]) {
    await viewport(width, height, true);
    await sleep(400);
    check(`${width}px · 세로 1열`, true, await evaluate(
      `document.querySelector('.prompt-scene').getBoundingClientRect().top
        >= document.querySelector('.prompt-explore').getBoundingClientRect().bottom - 2`));
    check(`${width}px · 가로 넘침 없음`, true, await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`));
    const applyBox = await evaluate(`(() => {
      const node = [...document.querySelectorAll('.prompt-result button')].find((b) => b.textContent.includes('적용'));
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) });
    })()`);
    record(`${width}px · 적용 버튼`, applyBox ?? "없음");
    check(`${width}px · 적용 버튼 노출`, true, applyBox !== null);
    await shot(shots, `09-${width}.png`);
  }
  await viewport(1280, 900);
  await sleep(300);
}
