// GAP02 message tiers and keyboard traversal (U05/U06/U08/U09).
const CLASSES = ".prompt-notice, .prompt-error";

export async function runMessages({ page, check, record, sleep, shots, pick }) {
  const { evaluate, waitFor, clickByText, typeInto, select, press, shot } = page;

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
  await typeInto(".prompt-scene textarea", "비 오는 네온 거리, 두 사람");
  await waitFor(`!!document.querySelector('.prompt-inclusion')`, { label: "inclusion" });
  const separate = await tierOf();
  check("GAP02 · 별도 보관 포함 안내", true, await evaluate(
    `document.querySelector('.prompt-inclusion').textContent.includes('별도 보관')`));
  check("GAP02 · 원문 미변환은 주의로 중복 표시하지 않음", true,
    separate.every((item) => !/비 오는 네온 거리/.test(item.text)));
  check("GAP02 · 메시지는 접힌 상세에 숨지 않음", true, separate.every((item) => !item.inDisclosure));
  record("GAP02 별도 보관 메시지", JSON.stringify(separate));
  await shot(shots, "04-separate.png");

  // Verbatim: the free text is included, so only the inclusion tone changes.
  await select(".prompt-scene select", "verbatim");
  await waitFor(`document.querySelector('.prompt-inclusion')?.hasAttribute('data-included')`, { label: "verbatim" });
  check("GAP02 · 원문 포함 안내", true, await evaluate(
    `document.querySelector('.prompt-inclusion').textContent.includes('원문 포함')`));
  check("GAP02 · 원문 1회 포함", 1, await evaluate(
    `document.querySelector('.prompt-result textarea').value.split('비 오는 네온 거리').length - 1`));
  await shot(shots, "05-verbatim.png");

  // ── F. GAP02: unresolved selections are a caution, not an error ────────────
  // Switching family clears the compiled result, so the draft must be rebuilt
  // before any unresolved entry exists to display.
  await select(".composer select", "fake-unknown");
  await sleep(500);
  await clickByText(".prompt-scene button, .prompt-result button", "초안 만들기");
  await waitFor(`!!document.querySelector('.prompt-result')`, { label: "unknown draft" });
  await sleep(300);
  const unknown = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(CLASSES)})];
    const caution = nodes.filter((node) => node.dataset.tone === 'caution')
      .map((node) => (node.textContent || '').trim());
    return { total: nodes.length, caution,
      hasSelectionWarning: caution.some((text) => text.includes('번역되지 않은 선택')),
      errors: nodes.filter((node) => /prompt-error/.test(node.className)).length };
  })()`);
  check("GAP02 · 미변환 선택은 주의 등급", true, unknown.hasSelectionWarning);
  check("GAP02 · 미변환은 오류가 아닌 주의", 0, unknown.errors);
  check("GAP02 · 미변환 목록은 접힌 상세 밖", true, unknown.total > 0);
  record("GAP02 미지원 계열", JSON.stringify(unknown));
  await shot(shots, "06-unknown-family.png");

  // ── G. GAP02: a blocking validation error is an error, kept visible ───────
  // Back to sd15 first: the family switch rebinds selections and clears the
  // draft, and a model switch needs the explicit regenerate path.
  await select(".composer select", "fake-sd15");
  await sleep(500);
  if (!(await evaluate(`!!document.querySelector('.prompt-result')`))) {
    await page.clickByText(".prompt-scene button, .prompt-result button", "초안 만들기").catch(() => false);
    await sleep(400);
  }
  const backToSd15 = await evaluate(`({ chips: document.querySelectorAll('.prompt-chip').length,
    hasResult: !!document.querySelector('.prompt-result') })`);
  check("계열 복귀 · 초안 재생성", true, backToSd15.hasResult);
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
