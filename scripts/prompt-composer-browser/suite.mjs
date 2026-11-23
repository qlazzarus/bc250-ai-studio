// GAP04 browser verification. Every scenario records input, expectation and the
// observed value. A fake backend and a temporary data directory are required; the
// suite never touches production and never prints keys or personal output.
import { runMessages } from "./suite-messages.mjs";
import { runKeyboard } from "./suite-keyboard.mjs";
import { runContracts } from "./suite-contracts.mjs";
import { runTrans06 } from "./suite-trans06.mjs";
import { runU12 } from "./suite-u12.mjs";
import { runUcp08 } from "./suite-ucp08.mjs";
import { adjustOpen, closeAdjust, openAdjust, pickEntry, stageOrder, waitAdjustOpen, waitSearchFocus } from "./ui.mjs";

export async function runSuite({ page, browser, sessionId, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select, press, shot } = page;

  // ── A. isolated start ────────────────────────────────────────────────────────
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`, { label: "models loaded", timeout: 20000 });
  record("환경", `${await evaluate("navigator.userAgent")} · ${await evaluate("innerWidth")}x${await evaluate("innerHeight")}`);
  await select(".composer select", "fake-sd15");
  await waitFor(`document.querySelector('.composer select').value === 'fake-sd15'`, { label: "fake-sd15 selected" });
  await click(".prompt-builder > .quiet");
  await waitFor(`!document.querySelector('#prompt-builder-panel').hidden`, { label: "builder open" });
  await shot(shots, "01-open.png");

  // ── B. UX01: the description is the entry point, the picker is the detail step ─
  const stage = await stageOrder(page);
  check("UX01 · 설명 → 요약 → 세부 조정 → 초안 순서", true, stage.present && stage.stacked);
  record("UX01 단계 위치", JSON.stringify(stage.tops));
  const firstField = await evaluate(`(() => {
    const node = document.querySelector('#prompt-builder-panel input, #prompt-builder-panel textarea, #prompt-builder-panel select');
    return { id: node?.id ?? null, tag: node?.tagName ?? null };
  })()`);
  check("UX01 · 첫 입력은 한국어 설명", "free-text-ko", firstField.id);
  check("UX01 · 사전 탐색은 기본 접힘", false, await adjustOpen(page));
  check("UX02 · 접힌 탐색은 닫힌 details 안", true,
    await evaluate(`!!document.querySelector('.prompt-explore input[type=search]')
      .closest('details.prompt-adjust:not([open])')`));
  check("UX01 · 설명 제목 노출", true, await evaluate(
    `document.querySelector('.prompt-brief .prompt-section-heading')?.textContent.includes('어떤 장면')`));
  await shot(shots, "02-brief-first.png");

  // ── C. UX05: examples fill the field and never generate ─────────────────────
  const examples = await evaluate(`[...document.querySelectorAll('.prompt-examples button')]
    .map((node) => node.textContent.trim())`);
  check("UX05 · 예시 3개 노출", JSON.stringify(["일상", "제품", "풍경"]), JSON.stringify(examples));

  // An occupied field must survive an accidental click: cancel keeps every value.
  await typeInto("#free-text-ko", "직접 쓴 장면 설명");
  await evaluate(`window.__c = 0; window.confirm = () => { window.__c += 1; return false; };`);
  await clickByText(".prompt-examples button", "제품");
  await sleep(250);
  check("UX05 · 기존 입력이 있으면 확인", 1, await evaluate(`window.__c`));
  check("UX05 · 취소 시 입력 유지", "직접 쓴 장면 설명", await evaluate(`document.querySelector('#free-text-ko').value`));
  check("UX05 · 취소 안내", true, await evaluate(
    `document.querySelector('#prompt-builder-panel > p[role=status]')?.textContent.includes('취소')`));

  await evaluate(`window.confirm = () => true;`);
  await clickByText(".prompt-examples button", "일상");
  await sleep(250);
  const filled = await evaluate(`(() => ({
    text: document.querySelector('#free-text-ko').value,
    origin: document.querySelector('.prompt-origin__text')?.textContent ?? null,
    notice: document.querySelector('#prompt-builder-panel > p[role=status]')?.textContent ?? null,
    jobs: document.querySelectorAll('.job').length,
  }))()`);
  check("UX05 · 예시가 설명을 채움", true, filled.text.includes("편의점"));
  check("UX04 · 원문 영역이 같은 문자열을 보여줌", filled.text, filled.origin);
  check("UX05 · 예시 적용 안내", true, (filled.notice || "").includes("예시를 넣었습니다"));
  check("UX05 · 예시는 생성을 호출하지 않음", 0, filled.jobs);
  record("UX05 예시 적용", JSON.stringify({ length: filled.text.length, notice: filled.notice }));
  await shot(shots, "03-examples.png");

  // ── D. GAP03 entry point ─────────────────────────────────────────────────────
  check("GAP03 · 초기 목록은 전체", true, await evaluate(`(() => {
    const active = [...document.querySelectorAll('.prompt-categories button')]
      .find((node) => node.getAttribute('aria-pressed') === 'true');
    return !!active && active.textContent.trim().startsWith('전체');
  })()`));

  check("GAP03 · 빈 상태에 시작 버튼", true, await evaluate(
    `[...document.querySelectorAll('.prompt-scene .prompt-empty__actions .quiet')].some((b) => b.textContent.includes('대상부터 고르기'))`));
  await clickByText(".prompt-scene .prompt-empty__actions .quiet", "대상부터 고르기");
  await waitFor(`document.querySelector('.prompt-explore input[type=search]') === document.activeElement`, { label: "search focused" });
  check("UX02 · 시작 버튼이 세부 조정을 엶", true, await adjustOpen(page));
  check("GAP03 · 대상 분류로 좁힘", true, await evaluate(`(() => {
    const active = [...document.querySelectorAll('.prompt-categories button')]
      .find((node) => node.getAttribute('aria-pressed') === 'true');
    return !!active && active.textContent.includes('대상');
  })()`));
  check("GAP03 · 좁힌 뒤 검색 입력 포커스", true, await waitSearchFocus(page, "search focused after start"));
  await shot(shots, "04-subject-entry.png");

  // ── E. selections across three groups ───────────────────────────────────────
  await pickEntry(page, "대상");
  await pickEntry(page, "조명");
  await pickEntry(page, "분위기");
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 3`, { label: "three chips" });
  check("선택 3개 · 칩 3개", 3, await evaluate(`document.querySelectorAll('.prompt-chip').length`));
  const groupNames = await evaluate(`(() => {
    const order = ['대상', '조명·스타일', '분위기'];
    const groups = [...document.querySelectorAll('.prompt-group > strong')].map((node) => node.textContent);
    return JSON.stringify(groups.filter((name) => order.includes(name)));
  })()`);
  check("칩 그룹 순서 고정", '["대상","조명·스타일","분위기"]', groupNames);

  // ── F. UX04: Korean summary rows beside the untouched original text ─────────
  const summary = await evaluate(`(() => ({
    rows: [...document.querySelectorAll('.prompt-group')].map((row) => ({
      label: row.querySelector('strong')?.textContent ?? null,
      empty: row.hasAttribute('data-empty'),
      chips: row.querySelectorAll('.prompt-chip').length,
    })),
    empties: [...document.querySelectorAll('.prompt-summary-empty')].map((node) => node.textContent.trim()),
    origin: document.querySelector('.prompt-origin__text')?.textContent ?? null,
    freeText: document.querySelector('#free-text-ko').value,
  }))()`);
  check("UX04 · 요약 행 7개", 7, summary.rows.length);
  check("UX04 · 선택 없는 행은 지정 안 함", true,
    summary.rows.filter((row) => row.empty).every((row) => row.chips === 0)
      && summary.empties.includes("지정 안 함"));
  check("UX04 · 선택한 세 행만 칩을 가짐", true,
    summary.rows.filter((row) => row.chips > 0).length === 3
      && summary.rows.filter((row) => row.chips > 0).every((row) => !row.empty));
  check("UX04 · 요약은 원문을 바꾸지 않음", summary.freeText, summary.origin);
  record("UX04 요약", JSON.stringify(summary.rows.map((row) => `${row.label}:${row.chips}`)));
  await shot(shots, "05-summary-origin.png");

  // ── G. GAP01 focus restoration (real key events) ────────────────────────────
  await evaluate(`document.querySelectorAll('.prompt-chip button')[1].focus()`);
  const middleLabel = await evaluate(`document.querySelectorAll('.prompt-chip button')[1].getAttribute('aria-label')`);
  const nextLabel = await evaluate(`document.querySelectorAll('.prompt-chip button')[2].getAttribute('aria-label')`);
  await press("Enter", "Enter", 13);
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 2`, { label: "middle removed" });
  check("GAP01 · 중간 제거 후 다음 칩으로 포커스", nextLabel,
    await evaluate(`document.activeElement.getAttribute('aria-label')`));
  record("GAP01 중간 제거", `제거 ${middleLabel} → 포커스 ${nextLabel}`);

  // Removing the last rendered chip must fall back to the previous one.
  await evaluate(`(() => { const n = [...document.querySelectorAll('.prompt-chip button')]; n[n.length - 1].focus(); return true; })()`);
  const previousLabel = await evaluate(`document.querySelectorAll('.prompt-chip button')[0].getAttribute('aria-label')`);
  await press("Enter", "Enter", 13);
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 1`, { label: "last removed" });
  check("GAP01 · 전체 마지막 칩 제거 후 이전 칩으로", previousLabel,
    await evaluate(`document.activeElement.getAttribute('aria-label')`));

  await press("Enter", "Enter", 13);
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 0`, { label: "all removed" });
  check("GAP01 · 마지막 칩 제거 후 탐색 입력으로", true, await waitSearchFocus(page, "focus after last chip"));
  await shot(shots, "06-focus-after-removal.png");

  // ── H. UX02: a folded picker is opened before focus goes into it ────────────
  await closeAdjust(page);
  await pickEntry(page, "대상");
  await closeAdjust(page);
  await evaluate(`document.querySelector('.prompt-chip button').focus()`);
  await press("Enter", "Enter", 13);
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 0`, { label: "only chip removed" });
  check("UX02 · 마지막 칩 제거 시 접힌 세부 조정을 엶", true,
    await waitAdjustOpen(page, "adjust reopened after removal"));
  check("UX02 · 열린 뒤 검색 입력으로 포커스", true, await waitSearchFocus(page, "focus after folded removal"));

  // Clearing every chip lands in the same place, and cancelling keeps them.
  await pickEntry(page, "대상");
  await pickEntry(page, "조명");
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 2`, { label: "two chips again" });
  await evaluate(`window.__c = 0; window.confirm = () => { window.__c += 1; return false; };`);
  await clickByText(".prompt-group-heading .quiet", "선택 비우기");
  await sleep(250);
  check("전체 비우기 · 취소 시 유지", 2, await evaluate(`document.querySelectorAll('.prompt-chip').length`));
  check("전체 비우기 · 확인창 호출", 1, await evaluate(`window.__c`));
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".prompt-group-heading .quiet", "선택 비우기");
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 0`, { label: "cleared" });
  check("전체 비우기 · 마지막 포커스는 탐색 입력", true, await waitSearchFocus(page, "focus after clear"));

  await runMessages({ page, check, record, sleep, shots, openAdjust,
    pick: (category, index = 0) => pickEntry(page, category, index) });
  await runKeyboard({ page, check, record, sleep, shots });
  await runContracts({ page, check, record, sleep, shots });
  // TRANS06 runs last: it reloads the page so it owns the builder state it asserts on.
  await runTrans06({ page, check, record, sleep, shots });
  // U12 needs the v2 capability stub from §N, so it must run after it — and it reloads
  // too, so nothing above can leak a half-built record into the storage checks.
  await runU12({ page, check, record, sleep, shots });
  // UCP08 replaces the capability/endpoint stubs with its own and reloads, so it runs
  // last: its v3 submit must not inherit a v2 `remainder` stub from §N.
  await runUcp08({ page, check, record, sleep, shots });
}
