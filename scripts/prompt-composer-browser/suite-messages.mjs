// GAP02 message tiers and keyboard traversal (U05/U06/U08/U09).
import { openDraft } from "./ui.mjs";

const CLASSES = ".prompt-notice, .prompt-error";

export async function runMessages({ page, check, record, sleep, shots, pick, openAdjust }) {
  const { evaluate, waitFor, clickByText, typeInto, select, shot } = page;

  const tierOf = async () => evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(CLASSES)})];
    return nodes.map((node) => ({
      tone: node.dataset.tone || (/prompt-error/.test(node.className) ? 'error' : 'info'),
      text: (node.textContent || '').trim().slice(0, 60),
      inDisclosure: !!node.closest('details'),
    }));
  })()`);

  // ── E. GAP02: separate mode reports the free text once, as a hint ───────────
  await pick("대상");
  await pick("조명");
  await typeInto("#free-text-ko", "비 오는 네온 거리, 두 사람");
  await waitFor(`!!document.querySelector('.prompt-inclusion')`, { label: "inclusion" });
  const separate = await tierOf();
  check("GAP02 · 별도 보관 포함 안내", true, await evaluate(
    `document.querySelector('.prompt-inclusion').textContent.includes('별도 보관')`));
  check("GAP02 · 원문 미변환은 주의로 중복 표시하지 않음", true,
    separate.every((item) => !/비 오는 네온 거리/.test(item.text)));
  check("GAP02 · 메시지는 접힌 상세에 숨지 않음", true, separate.every((item) => !item.inDisclosure));
  record("GAP02 별도 보관 메시지", JSON.stringify(separate));
  await shot(shots, "07-separate.png");

  // UX01: the description never turns into selections on its own.
  check("UX04 · 설명만으로는 요약이 채워지지 않음", 2,
    await evaluate(`document.querySelectorAll('.prompt-chip').length`));
  check("UX04 · 원문은 설명 그대로", "비 오는 네온 거리, 두 사람",
    await evaluate(`document.querySelector('.prompt-origin__text')?.textContent`));

  // Verbatim: the free text is included, so only the inclusion tone changes.
  await select("#free-text-mode", "verbatim");
  await waitFor(`document.querySelector('.prompt-inclusion')?.hasAttribute('data-included')`, { label: "verbatim" });
  check("GAP02 · 원문 포함 안내", true, await evaluate(
    `document.querySelector('.prompt-inclusion').textContent.includes('원문 포함')`));
  check("GAP02 · 원문 1회 포함", 1, await evaluate(
    `document.querySelector('.prompt-result textarea').value.split('비 오는 네온 거리').length - 1`));
  await shot(shots, "08-verbatim.png");

  // UX04: the English draft is a detail; the apply control is not.
  check("UX04 · 영어 초안은 기본 접힘", false, await evaluate(`document.querySelector('.prompt-draft').open`));
  check("UX04 · 적용 버튼은 접힘 밖", true, await evaluate(`(() => {
    const node = [...document.querySelectorAll('.prompt-result button')].find((b) => b.textContent.includes('적용'));
    return !!node && node.getBoundingClientRect().height > 0 && !node.closest('details');
  })()`));
  check("UX04 · 초안 펼치기", true, await openDraft(page));
  await shot(shots, "09-draft-open.png");

  // ── E2. VERIFY01: an out-of-date draft can never be applied ────────────────
  // Editing the description regenerates the draft here, so this asserts the
  // invariant instead of fabricating a state: after an edit the draft must be
  // current, or the apply control must be blocked. A silent apply of an old draft
  // fails either way, and the disabled branch itself is covered by the unit test
  // in frontend/tests/prompt-presentation.test.mjs.
  const finalBefore = await evaluate(`document.querySelector('.composer textarea[rows="5"]').value`);
  const draftBefore = await evaluate(`document.querySelector('.prompt-draft textarea')?.value ?? null`);
  await typeInto("#free-text-ko", "비 오는 네온 거리, 두 사람, 그리고 세 번째 사람");
  await sleep(400);
  const afterEdit = await evaluate(`(() => {
    const apply = [...document.querySelectorAll('.prompt-result button')].find((b) => b.textContent.includes('적용'));
    return {
      disabled: apply ? apply.disabled : null,
      draft: document.querySelector('.prompt-draft textarea')?.value ?? null,
      caution: [...document.querySelectorAll('[data-tone="caution"]')]
        .some((node) => node.textContent.includes('초안을 다시 만들어')),
    };
  })()`);
  const regenerated = afterEdit.draft !== draftBefore;
  check("stale 초안 · 재생성 또는 적용 차단", true, regenerated ? afterEdit.disabled === false : afterEdit.disabled === true);
  record("stale 초안 상태", JSON.stringify({ regenerated, disabled: afterEdit.disabled, caution: afterEdit.caution }));

  // Applying right after the edit must write the freshly compiled draft, never the
  // one that was on screen before the description changed.
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".prompt-result button", "적용").catch(() => false);
  await sleep(300);
  const finalAfter = await evaluate(`document.querySelector('.composer textarea[rows="5"]').value`);
  check("stale 초안 · 옛 초안으로 덮어쓰지 않음", true,
    regenerated ? finalAfter !== finalBefore && finalAfter.trim() === (afterEdit.draft ?? "").trim()
      : finalAfter === finalBefore);

  // ── F. GAP02: unresolved selections are a caution, not an error ────────────
  // Switching family clears the compiled result, so the draft must be rebuilt
  // before any unresolved entry exists to display.
  await select(".composer select", "fake-unknown");
  await sleep(500);
  await clickByText(".prompt-result button", "초안 만들기");
  await waitFor(`!!document.querySelector('.prompt-draft')`, { label: "unknown draft" });
  await sleep(300);
  const unknown = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(CLASSES)})];
    const caution = nodes.filter((node) => node.dataset.tone === 'caution')
      .map((node) => (node.textContent || '').trim());
    const list = document.querySelector('.prompt-result .prompt-notice[data-tone="caution"] ul');
    return { total: nodes.length, caution,
      hasSelectionWarning: caution.some((text) => text.includes('번역되지 않은 선택')),
      errors: nodes.filter((node) => /prompt-error/.test(node.className)).length,
      listVisible: !!list && list.getBoundingClientRect().height > 0,
      listInDisclosure: !!list?.closest('details') };
  })()`);
  check("GAP02 · 미변환 선택은 주의 등급", true, unknown.hasSelectionWarning);
  check("GAP02 · 미변환은 오류가 아닌 주의", 0, unknown.errors);
  check("GAP02 · 미변환 목록은 접힘 밖에서 보임", true, unknown.listVisible && !unknown.listInDisclosure);
  record("GAP02 미지원 계열", JSON.stringify(unknown));
  await shot(shots, "10-unknown-family.png");

  // ── G. GAP02: a blocking validation error is an error, kept visible ───────
  // Back to sd15 first: the family switch rebinds selections and clears the
  // draft, and a model switch needs the explicit regenerate path.
  await select(".composer select", "fake-sd15");
  await sleep(500);
  if (!(await evaluate(`!!document.querySelector('.prompt-draft')`))) {
    await clickByText(".prompt-result button", "초안 만들기").catch(() => false);
    await sleep(500);
  }
  const backToSd15 = await evaluate(`({ chips: document.querySelectorAll('.prompt-chip').length,
    hasDraft: !!document.querySelector('.prompt-draft') })`);
  check("계열 복귀 · 초안 재생성", true, backToSd15.hasDraft);
  record("계열 복귀 상태", JSON.stringify(backToSd15));
  // #prompt-errors is the final-prompt field (App), not the builder; a blocking
  // error there must still use the error tier and stay outside disclosures.
  await typeInto(".composer textarea[rows='5']", "x".repeat(8001));
  await sleep(300);
  const blocking = await evaluate(`(() => {
    const node = document.querySelector('#prompt-errors .prompt-error');
    return { exists: !!node, text: node ? node.textContent.slice(0, 80) : null,
      inDisclosure: node ? !!node.closest('details') : null,
      generateDisabled: document.querySelector('button.generate').disabled };
  })()`);
  check("GAP02 · 한도 초과는 오류 등급", true, blocking.exists);
  check("GAP02 · 오류는 접힌 상세 밖", false, blocking.inDisclosure);
  check("GAP02 · 오류 시 생성 차단", true, blocking.generateDisabled);
  record("GAP02 오류 표시", JSON.stringify(blocking));
  await shot(shots, "07-blocking-error.png");
  await typeInto(".composer textarea[rows='5']", "quiet portrait");
  await sleep(200);
}
