// Keyboard and responsive checks (U09). Real Tab/Shift+Tab/Space/Enter events, so
// "keyboard reachable" means traversal actually reaches the control.
import { adjustOpen, closeAdjust, stageOrder } from "./ui.mjs";

export async function runKeyboard({ page, check, record, sleep, shots }) {
  const { evaluate, press, activeInfo, viewport, shot, clickByText, waitFor } = page;

  // ── Reading order: the toggle is followed by the description, not by the picker.
  await closeAdjust(page);
  await evaluate(`document.querySelector('.prompt-builder > .quiet').focus()`);
  const seen = [];
  const inAdjust = [];
  for (let index = 0; index < 4; index += 1) {
    await press("Tab", "Tab", 9);
    seen.push(await activeInfo());
    inAdjust.push(await evaluate(`!!document.activeElement?.closest('.prompt-adjust')`));
  }
  const backward = [];
  for (let index = 0; index < 4; index += 1) {
    await press("Tab", "Tab", 9, 8);
    backward.push(await activeInfo());
  }
  /** One stable identity per stop: id when present, else tag + label text. */
  const idOf = (node) => (node ? `${node.tag}:${node.id ?? node.label ?? ""}:${node.text}` : "none");
  record("키보드 Tab 순회", JSON.stringify(seen));
  record("키보드 Shift+Tab 순회", JSON.stringify(backward));
  const textIndex = seen.findIndex((item) => item?.id === "free-text-ko");
  check("키보드 · 설명 입력이 첫 입력", true, textIndex > 0);
  check("키보드 · 접힌 세부 조정 내부는 순회 밖", true, inAdjust.every((flag) => flag === false));

  // VERIFY01: Shift+Tab must retrace the exact forward stops, not merely produce
  // three records. Comparing identifiers is what makes a broken key event fail.
  const expectedBack = [seen[2], seen[1], seen[0], { tag: "BUTTON", id: null, label: null, text: "프롬프트 구성 닫기" }];
  check("키보드 · 역순 정확히 일치", JSON.stringify(expectedBack.map(idOf)),
    JSON.stringify(backward.map(idOf)));

  // ── The folded detail step opens from the keyboard, then its search is reachable.
  await evaluate(`document.querySelector('.prompt-adjust > summary').focus()`);
  await press("Enter", "Enter", 13);
  await waitFor(`document.querySelector('.prompt-adjust').open`, { label: "adjust via keyboard" });
  check("키보드 · Enter로 세부 조정 열기", true, await adjustOpen(page));
  await press("Tab", "Tab", 9);
  check("키보드 · 열린 탐색의 검색 입력 도달", "search",
    await evaluate(`document.querySelector('.prompt-explore input').type`));
  check("키보드 · 검색 입력 포커스", true, await evaluate(
    `document.activeElement === document.querySelector('.prompt-explore input[type=search]')`));
  await press("Tab", "Tab", 9);
  check("키보드 · 분류 버튼 도달", true, /선택 \d/.test((await activeInfo())?.text || ""));

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
  await shot(shots, "11-keyboard.png");

  // Touch target sizes and responsive layout.
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
    const mobileStage = await stageOrder(page);
    check(`${width}px · 설명 → 요약 → 세부 조정 → 초안 1열`, true, mobileStage.present && mobileStage.stacked);
    check(`${width}px · 가로 넘침 없음`, true, await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`));
    const applyBox = await evaluate(`(() => {
      const node = [...document.querySelectorAll('.prompt-result button')].find((b) => b.textContent.includes('적용'));
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) });
    })()`);
    record(`${width}px · 적용 버튼`, applyBox ?? "없음");
    check(`${width}px · 적용 버튼 노출`, true, applyBox !== null);
    await shot(shots, `12-${width}.png`);
  }
  await viewport(1280, 900);
  await sleep(300);
}
