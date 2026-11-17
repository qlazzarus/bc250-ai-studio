// GAP04 browser verification. Every scenario records input, expectation and the
// observed value. A fake backend and a temporary data directory are required; the
// suite never touches production and never prints keys or personal output.
import { runMessages } from "./suite-messages.mjs";
import { runKeyboard } from "./suite-keyboard.mjs";
import { runContracts } from "./suite-contracts.mjs";

export async function runSuite({ page, browser, sessionId, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select, press, isActive, activeInfo, viewport, shot } = page;

  // ── A. isolated start ────────────────────────────────────────────────────────
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`, { label: "models loaded", timeout: 20000 });
  record("환경", `${await evaluate("navigator.userAgent")} · ${await evaluate("innerWidth")}x${await evaluate("innerHeight")}`);
  await select(".composer select", "fake-sd15");
  await waitFor(`document.querySelector('.composer select').value === 'fake-sd15'`, { label: "fake-sd15 selected" });
  await click(".prompt-builder > .quiet");
  await waitFor(`!document.querySelector('#prompt-builder-panel').hidden`, { label: "builder open" });
  await shot(shots, "01-open.png");

  // ── B. GAP03 entry point ─────────────────────────────────────────────────────
  check("GAP03 · 초기 목록은 전체", true, await evaluate(`(() => {
    const active = [...document.querySelectorAll('.prompt-categories button')]
      .find((node) => node.getAttribute('aria-pressed') === 'true');
    return !!active && active.textContent.trim().startsWith('전체');
  })()`));
  check("GAP03 · 빈 상태에 시작 버튼", true, await evaluate(
    `[...document.querySelectorAll('.prompt-scene .prompt-empty__actions .quiet')].some((b) => b.textContent.includes('대상부터 고르기'))`));
  await clickByText(".prompt-scene .prompt-empty__actions .quiet", "대상부터 고르기");
  await waitFor(`document.querySelector('.prompt-explore input[type=search]') === document.activeElement`, { label: "search focused" });
  check("GAP03 · 대상 분류로 좁힘", true, await evaluate(`(() => {
    const active = [...document.querySelectorAll('.prompt-categories button')]
      .find((node) => node.getAttribute('aria-pressed') === 'true');
    return !!active && active.textContent.includes('대상');
  })()`));
  check("GAP03 · 좁힌 뒤 검색 입력 포커스", "INPUT", (await activeInfo()).tag);
  await shot(shots, "02-subject-entry.png");

  // ── C. selections across three groups ───────────────────────────────────────
  const pick = async (category, index = 0) => {
    await clickByText(".prompt-categories button", category);
    await sleep(150);
    await click(".prompt-choice input", index);
    await sleep(120);
  };
  await pick("대상");
  await pick("조명");
  await pick("분위기");
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 3`, { label: "three chips" });
  check("선택 3개 · 칩 3개", 3, await evaluate(`document.querySelectorAll('.prompt-chip').length`));
  const groupNames = await evaluate(`(() => {
    const order = ['대상', '조명', '분위기'];
    const groups = [...document.querySelectorAll('.prompt-group > strong')].map((node) => node.textContent);
    return JSON.stringify(groups.filter((name) => order.includes(name)));
  })()`);
  check("칩 그룹 순서 고정", '["대상","조명","분위기"]', groupNames);

  // ── D. GAP01 focus restoration (real key events) ────────────────────────────
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
  check("GAP01 · 마지막 칩 제거 후 탐색 입력으로", true, await isActive(".prompt-explore input[type=search]"));
  await shot(shots, "03-focus-after-removal.png");

  // Clearing every chip lands in the same place, and cancelling keeps them.
  await pick("대상");
  await pick("조명");
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 2`, { label: "two chips again" });
  await evaluate(`window.__c = 0; window.confirm = () => { window.__c += 1; return false; };`);
  await clickByText(".prompt-group-heading .quiet", "선택 비우기");
  await sleep(250);
  check("전체 비우기 · 취소 시 유지", 2, await evaluate(`document.querySelectorAll('.prompt-chip').length`));
  check("전체 비우기 · 확인창 호출", 1, await evaluate(`window.__c`));
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".prompt-group-heading .quiet", "선택 비우기");
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 0`, { label: "cleared" });
  check("전체 비우기 · 마지막 포커스는 탐색 입력", true, await isActive(".prompt-explore input[type=search]"));

  await runMessages({ page, check, record, sleep, shots, pick });
  await runKeyboard({ page, check, record, sleep, shots });
  await runContracts({ page, check, record, sleep, shots });
}
