/**
 * TRANS06 in a real browser: an included translation must survive a model-family change.
 *
 * The regression was visible only on screen: changing the family erased the accepted
 * translation from the panel and the next apply recorded a v1 body without `remainder`.
 * A unit test can replay the store transitions, but only the page can show that the
 * panel still lists the phrase, and only the actual request proves what was re-recorded
 * — so this suite reads element text and the POST body the app itself sent.
 *
 * The proposal endpoint is stubbed in this page (the fake engine cannot write a
 * translation), exactly like the LLM-I04 block. Nothing here is a real model result.
 */
import { openBuilder, pickEntry } from "./ui.mjs";

const PHRASE_KO = "비치는 골목에 선";
const PHRASE_EN = "a street lit by neon";
const FREE_TEXT = "네온이 비치는 골목에 선 사람";

export async function runTrans06({ page, check, record, sleep, shots }) {
  const { evaluate, waitFor, click, clickByText, typeInto, select, shot } = page;

  // A reload, so this block owns the whole builder state: earlier sections apply,
  // switch families and leave chips behind, and an inherited record would make the
  // "kept across a rebind" claim unfalsifiable.
  await page.call("Page.reload", { ignoreCache: false });
  await waitFor(`!!document.querySelector('.prompt-builder > .quiet')`, { label: "reload for TRANS06", timeout: 20000 });
  await waitFor(`document.querySelectorAll('.composer select option').length > 1`, { label: "models after reload", timeout: 20000 });
  await select(".composer select", "fake-sd15");
  await sleep(600);
  await openBuilder(page);

  // The translate button only exists when the server advertises v2 *and* proposals.
  // If it is missing, the cause is in the capability payload, so record that first —
  // a bare timeout would not say whether v2, the proposal schema or the dictionary
  // version was the missing piece.
  const capability = await evaluate(`(async () => {
    // XHR, not fetch: this bypasses the page's interceptors, so the answer says what
    // the server really advertises instead of what the stub rewrote.
    const raw = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/v1/system/capabilities');
      xhr.setRequestHeader('Authorization', window.__authHeader || '');
      xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({ error: String(e) }); } };
      xhr.onerror = () => resolve({ error: 'xhr' });
      xhr.send();
    });
    let viaFetch = null;
    try {
      const response = await fetch('/api/v1/system/capabilities', {
        headers: { Authorization: window.__authHeader || '' } });
      const body = await response.json();
      viaFetch = { composition: body.prompt_composition ?? null, proposals: body.prompt_proposals ?? null };
    } catch (error) { viaFetch = { error: String(error) }; }
    return {
      server: { composition: raw.prompt_composition ?? null, proposals: raw.prompt_proposals ?? null },
      viaFetch,
      translateButton: !!document.querySelector('.prompt-proposals__translate'),
      panel: !!document.querySelector('.prompt-proposals'),
    };
  })()`);
  record("TRANS06 capability", JSON.stringify(capability));
  await waitFor(`!!document.querySelector('.prompt-proposals__translate')`, { label: "translate button", timeout: 20000 });
  const translateButton = await evaluate(`(() => {
    const button = document.querySelector('.prompt-proposals__translate');
    return { label: button.textContent.trim(), disabled: button.disabled };
  })()`);
  check("TRANS06 · 번역 요청 버튼 이름", "사전에 없는 구절 번역 제안", translateButton.label);
  // Empty text: nothing to translate, so the button must be disabled rather than
  // sending a request that can only return an empty list.
  check("TRANS06 · 원문 없으면 비활성", true, translateButton.disabled);

  await typeInto("#free-text-ko", FREE_TEXT);
  const armed = await evaluate(`(() => {
    const button = document.querySelector('.prompt-proposals__translate');
    return { disabled: button.disabled };
  })()`);
  check("TRANS06 · 원문을 쓰면 활성", false, armed.disabled);
  // A selection gives the draft a non-empty body, so the apply path assembles
  // "draft + translation" instead of taking the separate-only branch.
  await pickEntry(page, "대상");
  await waitFor(`document.querySelectorAll('.prompt-chip').length === 1`, { label: "one chip" });

  await evaluate(`(() => {
    window.__proposalReply = { translations: [
      { source_ko: ${JSON.stringify(PHRASE_KO)}, suggested_en: ${JSON.stringify(PHRASE_EN)}, confidence: 0.82 },
    ] };
    return true;
  })()`);

  await click(".prompt-proposals__translate");
  await waitFor(`!!document.querySelector('.prompt-remainder-card')`, { label: "translation card" });
  const cardText = await evaluate(`document.querySelector('.prompt-remainder-card')?.textContent ?? ''`);
  check("TRANS06 · 카드가 원문과 제안 번역을 표시", true,
    cardText.includes(PHRASE_KO) && cardText.includes(PHRASE_EN));

  await clickByText(".prompt-remainder-card button", "포함");
  await waitFor(`!!document.querySelector('.prompt-remainder-card[data-included]')`, { label: "included card" });
  const included = await evaluate(`(() => ({
    count: document.querySelector('.prompt-remainder__counts')?.textContent?.trim() ?? null,
    finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
  }))()`);
  check("TRANS06 · 포함 개수 표시", true, (included.count ?? "").includes("포함 1/"));

  check("TRANS06 · 포함 직후 최종 프롬프트 불변", "", included.finalPrompt);

  // Draft, then apply: this is the v2 record the rebind must not discard. The draft is
  // produced automatically by the text/selection edits above, so the manual button is
  // only used if it is the displayed recovery path.
  const draftBefore = await evaluate(`(() => {
    const generate = [...document.querySelectorAll('.prompt-result button')]
      .find((node) => node.textContent.includes('초안 만들기'));
    return { needsGenerate: Boolean(generate), hasDraft: !!document.querySelector('.prompt-draft') };
  })()`);
  if (draftBefore.needsGenerate) {
    await clickByText(".prompt-result button", "초안 만들기");
    await waitFor(`!!document.querySelector('.prompt-draft')`, { label: "draft" });
  }
  check("TRANS06 · 적용 전 초안 존재", true, await evaluate(`!!document.querySelector('.prompt-draft')`));
  await evaluate(`window.confirm = () => true;`);
  await clickByText(".prompt-result button", "초안을 최종 프롬프트에 적용");
  await waitFor(`document.querySelector('.prompt-status strong')?.textContent.includes('적용')`, { label: "applied" });

  const applied = await evaluate(`(() => {
    const draft = document.querySelector('.prompt-draft textarea')?.value ?? '';
    return {
      status: document.querySelector('.prompt-status strong')?.textContent?.trim() ?? null,
      draft,
      finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
    };
  })()`);
  check("TRANS06 · 적용 후 상태", "적용됨", applied.status);
  check("TRANS06 · 최종 프롬프트가 초안 + 번역", true,
    applied.finalPrompt === `${applied.draft}\n${PHRASE_EN}`);

  // ── the regression itself: change the model family ────────────────────────
  await evaluate(`window.confirm = () => true;`);
  await select(".composer select", "fake-flux2");
  await sleep(800);

  const afterRebind = await evaluate(`(() => {
    const panel = document.querySelector('.prompt-remainder-included');
    return {
      model: document.querySelector('.composer select').value,
      status: document.querySelector('.prompt-status strong')?.textContent?.trim() ?? null,
      detail: document.querySelector('.prompt-status__detail')?.textContent ?? '',
      panel: panel ? panel.textContent : null,
      panelItems: panel ? [...panel.querySelectorAll('li span')].map((node) => node.textContent) : [],
      finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
      hasDraft: !!document.querySelector('.prompt-draft'),
    };
  })()`);
  check("TRANS06 · 계열 변경됨", "fake-flux2", afterRebind.model);
  check("TRANS06 · 상태가 기록 유지를 밝힘", "모델 계열 변경 · 기록 유지", afterRebind.status);
  check("TRANS06 · 포함한 번역 패널 유지", true, afterRebind.panel !== null);
  check("TRANS06 · 번역과 원문이 그대로", JSON.stringify([`${PHRASE_KO} → ${PHRASE_EN}`]),
    JSON.stringify(afterRebind.panelItems));
  check("TRANS06 · 안내가 다시 적용을 설명", true,
    /다시 적용하면 같은 번역으로 새로 기록됩니다/.test(afterRebind.detail));
  // The draft is compiled for the other family, so it must be gone, and the final
  // prompt is untouched — the rebind keeps the record, not the stale draft.
  check("TRANS06 · 다른 계열 초안은 폐기", false, afterRebind.hasDraft);
  check("TRANS06 · 최종 프롬프트 불변", applied.finalPrompt, afterRebind.finalPrompt);
  record("TRANS06 계열 변경", JSON.stringify({ ...afterRebind, finalPrompt: afterRebind.finalPrompt.length }));
  await shot(shots, "35-trans06-family-changed.png");

  // ── re-apply in the new family ────────────────────────────────────────────
  // The rebind dropped the draft, so the recovery button is the only path here —
  // assert it is actually offered before clicking it.
  const recovery = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.prompt-result button')]
      .find((node) => node.textContent.includes('초안 만들기'));
    return { offered: Boolean(button), label: button?.textContent?.trim() ?? null };
  })()`);
  check("TRANS06 · 새 계열에서 초안 만들기 제공", "초안 만들기", recovery.label);
  await clickByText(".prompt-result button", "초안 만들기");
  await waitFor(`!!document.querySelector('.prompt-draft')`, { label: "draft for new family" });
  await sleep(300);
  const reapplyButton = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.prompt-result button')]
      .find((node) => node.textContent.includes('적용'));
    return { label: button?.textContent?.trim() ?? null, disabled: button?.disabled ?? null };
  })()`);
  check("TRANS06 · 새 계열에서 적용 가능", false, reapplyButton.disabled);
  await clickByText(".prompt-result button", "초안을 최종 프롬프트에 적용");
  await waitFor(`document.querySelector('.prompt-status strong')?.textContent.includes('적용')`, { label: "re-applied" });
  await sleep(300);

  const reApplied = await evaluate(`(() => {
    const draft = document.querySelector('.prompt-draft textarea')?.value ?? '';
    const panel = document.querySelector('.prompt-remainder-included');
    return {
      status: document.querySelector('.prompt-status strong')?.textContent?.trim() ?? null,
      draft,
      finalPrompt: document.querySelector('.composer textarea[rows="5"]').value,
      panelItems: panel ? [...panel.querySelectorAll('li span')].map((node) => node.textContent) : [],
    };
  })()`);
  // `selectionChanged`: the rebind rewrote the selections, so the record no longer
  // describes the screen even though it is a valid record again.
  check("TRANS06 · 재적용 후 상태", true,
    ["적용됨", "적용 후 선택 변경됨"].includes(reApplied.status));
  check("TRANS06 · 재적용도 번역을 포함", true,
    reApplied.finalPrompt === `${reApplied.draft}\n${PHRASE_EN}`);
  check("TRANS06 · 재적용 후에도 목록 유지", JSON.stringify([`${PHRASE_KO} → ${PHRASE_EN}`]),
    JSON.stringify(reApplied.panelItems));
  record("TRANS06 재적용", JSON.stringify({ ...reApplied, draft: reApplied.draft.length,
    finalPrompt: reApplied.finalPrompt.length }));
  await shot(shots, "36-trans06-reapplied.png");

  // ── what was actually recorded, read from the request the app sent ─────────
  // The snapshot is only observable where it leaves the browser, so the next POST
  // /jobs body is captured and asserted on instead of internal component state.
  await evaluate(`(() => {
    window.__jobBodies = [];
    if (!window.__realFetch) window.__realFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init && init.method) || "GET";
      if (url.includes("/jobs") && method === "POST" && init && typeof init.body === "string") {
        try { window.__jobBodies.push(JSON.parse(init.body)); } catch { /* ignore */ }
      }
      return window.__realFetch(input, init);
    };
    return true;
  })()`);
  await click("button.generate");
  await waitFor(`window.__jobBodies.length > 0`, { label: "submit captured", timeout: 20000 });
  const body = await evaluate(`(() => {
    const sent = window.__jobBodies[window.__jobBodies.length - 1] ?? {};
    const composition = sent.prompt_composition ?? null;
    return {
      hasComposition: composition !== null,
      schema: composition?.schema_version ?? null,
      family: composition?.target_family ?? null,
      remainder: composition?.remainder ?? null,
      draft: composition?.draft_prompt ?? null,
      prompt: sent.prompt ?? null,
    };
  })()`);
  await evaluate(`(() => { if (window.__realFetch) { window.fetch = window.__realFetch; delete window.__realFetch; } return true; })()`);

  check("TRANS06 · 요청에 구성 이력 포함", true, body.hasComposition);
  check("TRANS06 · 재적용은 v2로 기록", 2, body.schema);
  check("TRANS06 · 구성 계열은 새 계열", "flux2", body.family);
  check("TRANS06 · remainder 항목 1개", 1, Array.isArray(body.remainder) ? body.remainder.length : null);
  const entry = (body.remainder ?? [])[0] ?? {};
  check("TRANS06 · 원문/번역 보존", `${PHRASE_KO}|${PHRASE_EN}`, `${entry.source_ko}|${entry.suggested_en}`);
  check("TRANS06 · 출처 보존", "prop-browser|stub", `${entry.proposal_id}|${entry.proposal_model}`);
  check("TRANS06 · 수락 시각 기록", true, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(entry.accepted_at ?? ""));
  // The snapshot keeps the compiler output as the draft and the final prompt carries
  // the translation: the two are still separate facts in the record.
  check("TRANS06 · draft_prompt는 초안 그대로", true,
    typeof body.draft === "string" && !body.draft.includes(PHRASE_EN));
  check("TRANS06 · 최종 prompt는 번역 포함", true, (body.prompt ?? "").endsWith(`\n${PHRASE_EN}`));
  record("TRANS06 제출 본문", JSON.stringify({ schema: body.schema, family: body.family,
    remainder: body.remainder?.length ?? null, entry }));
  await shot(shots, "37-trans06-submitted.png");
}
