// Shared navigation for the UX01–UX05 layout. The picker now lives behind the
// "세부 조정" disclosure and the job queue behind 펼치기/접기, so every suite opens
// the same way instead of each test guessing the current shape.
export async function adjustOpen(page) {
  return page.evaluate(`!!document.querySelector('.prompt-adjust')?.open`);
}

/** Opens 세부 조정 only when closed; a native summary click keeps the real path. */
export async function openAdjust(page) {
  if (await adjustOpen(page)) return;
  await page.click(".prompt-adjust > summary");
  await waitAdjustOpen(page, "세부 조정 open");
}

/** The disclosure opens in a later commit than the chip removal, so poll for it. */
export async function waitAdjustOpen(page, label = "세부 조정 open", timeout = 4000) {
  await page.waitFor(`(() => {
    const node = document.querySelector('.prompt-adjust');
    const input = node?.querySelector('.prompt-explore input[type=search]');
    return !!node?.open && !!input && input.getBoundingClientRect().height > 0;
  })()`, { label, timeout });
  return true;
}

/** Closes 세부 조정 so a test can prove the restore path reopens it. */
export async function closeAdjust(page) {
  if (!(await adjustOpen(page))) return;
  await page.click(".prompt-adjust > summary");
  await page.waitFor(`!document.querySelector('.prompt-adjust')?.open`, { label: "세부 조정 closed" });
}

export async function chooseCategory(page, category) {
  await openAdjust(page);
  const clicked = await page.clickByText(".prompt-categories button", category);
  if (!clicked) throw new Error(`category not found: ${category}`);
  await page.waitFor(`[...document.querySelectorAll('.prompt-categories button')]
    .some((node) => node.getAttribute('aria-pressed') === 'true'
      && node.textContent.includes(${JSON.stringify(category)}))`, { label: `category ${category}` });
}

/** Chooses a category and toggles one checkbox inside it. */
export async function pickEntry(page, category, index = 0) {
  await chooseCategory(page, category);
  const before = await page.evaluate(`document.querySelectorAll('.prompt-chip').length`);
  await page.click(".prompt-choice input", index);
  await page.waitFor(`document.querySelectorAll('.prompt-chip').length !== ${before}`,
    { label: `chip count changed (${category})` });
  return page.evaluate(`document.querySelectorAll('.prompt-chip').length`);
}

export async function queueOpen(page) {
  return page.evaluate(`(() => {
    const body = document.querySelector('#jobs-body');
    return !!body && !body.hidden;
  })()`);
}

/** Uses the header button, so the check covers the control a user actually clicks. */
export async function setQueue(page, open) {
  if ((await queueOpen(page)) === open) return;
  const clicked = await page.clickByText(".jobs-actions button", open ? "펼치기" : "접기");
  if (!clicked) throw new Error(`queue toggle not found: ${open ? "펼치기" : "접기"}`);
  await page.waitFor(`(() => {
    const body = document.querySelector('#jobs-body');
    return !!body && (${open} ? !body.hidden : body.hidden);
  })()`, { label: `queue ${open ? "expanded" : "collapsed"}` });
}

/** The English draft must be opened before a user can read it. */
export async function openDraft(page) {
  const hasDraft = await page.evaluate(`!!document.querySelector('.prompt-draft')`);
  if (!hasDraft) return false;
  if (await page.evaluate(`document.querySelector('.prompt-draft').open`)) return true;
  await page.click(".prompt-draft > summary");
  await page.waitFor(`document.querySelector('.prompt-draft').open`, { label: "draft open" });
  return true;
}

/** Focus that waits for the commit; callers get true only once it really landed. */
export async function waitSearchFocus(page, label = "search focused") {
  try {
    await page.waitFor(
      `document.activeElement === document.querySelector('.prompt-explore input[type=search]')`,
      { label, timeout: 4000 });
    return true;
  } catch { return false; }
}

/** Positions of the four reading-order regions, top to bottom. */
export function stageOrder(page) {
  return page.evaluate(`(() => {
    const selectors = ['.prompt-brief', '.prompt-scene', '.prompt-adjust', '.prompt-result'];
    const boxes = selectors.map((selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null);
    if (boxes.some((box) => box === null)) return { present: false };
    const stacked = boxes.every((box, index) => index === 0 || box.top >= boxes[index - 1].bottom - 2);
    return { present: true, stacked, tops: boxes.map((box) => Math.round(box.top)) };
  })()`);
}
