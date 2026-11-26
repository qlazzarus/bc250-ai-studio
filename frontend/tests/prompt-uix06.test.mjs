/**
 * UIX06: the gallery dialogs' focus contract.
 *
 * The claims fall into two groups, and they need different evidence:
 *
 * 1. **Pure decisions** — which element Tab goes to, what a dialog is called, where focus returns
 *    after a given cause of closing. These are functions, so they are asserted directly. The
 *    wrap-around and the fallback chain are exactly the parts that are easy to get subtly wrong.
 * 2. **Wiring** — that the two components actually use the trap and the ids actually reach the
 *    DOM. There is no DOM in this test runner (no jsdom), so the wiring is asserted structurally
 *    on the sources, and the *behaviour* is left to the browser suite, which checks
 *    `document.activeElement` for real. A structural check here cannot claim a focus happened.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dialogLabel, nextFocusIndex, resolveReturn } from '../src/lib/dialog.ts';

const here = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(here, 'src');
const viewerSource = readFileSync(join(SRC, 'components/ImageViewer.tsx'), 'utf8');
const metadataSource = readFileSync(join(SRC, 'components/MetadataModal.tsx'), 'utf8');
const appSource = readFileSync(join(SRC, 'App.tsx'), 'utf8');


// ── 1. Tab arithmetic ─────────────────────────────────────────────────────────

test('Tab from the last stop wraps to the first, and Shift+Tab from the first wraps to the last', () => {
  // Three stops: close, previous, next.
  assert.equal(nextFocusIndex(2, 3, false), 0, 'Tab at the end must wrap to the start');
  assert.equal(nextFocusIndex(0, 3, true), 2, 'Shift+Tab at the start must wrap to the end');
  // The ordinary moves are still ordinary.
  assert.equal(nextFocusIndex(0, 3, false), 1);
  assert.equal(nextFocusIndex(2, 3, true), 1);
});

test('a single stop keeps focus on itself in both directions', () => {
  // The degenerate dialog (only a close button) must not wrap to -1 or throw.
  assert.equal(nextFocusIndex(0, 1, false), 0);
  assert.equal(nextFocusIndex(0, 1, true), 0);
});

test('focus outside the dialog enters at the right end', () => {
  // `current < 0` is "focus is not on a stop inside the dialog". Tab must enter at the start;
  // Shift+Tab must enter at the end, or the first keypress would jump past the dialog.
  assert.equal(nextFocusIndex(-1, 3, false), 0);
  assert.equal(nextFocusIndex(-1, 3, true), 2);
});

test('an empty dialog yields -1 so the caller can focus the container instead', () => {
  assert.equal(nextFocusIndex(0, 0, false), -1);
  assert.equal(nextFocusIndex(-1, 0, true), -1);
});

// ── 2. Accessible names ───────────────────────────────────────────────────────

test('a dialog name carries the image id, so two open dialogs are distinguishable', () => {
  const id = 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8';
  assert.equal(dialogLabel('이미지 보기', id), '이미지 보기 · c3d4e5f6');
  // Two different images must not produce the same name.
  assert.notEqual(dialogLabel('이미지 보기', id), dialogLabel('이미지 보기', `f${id.slice(1)}`));
  // The kind is still there, so the name says what the dialog is as well as which image.
  assert.match(dialogLabel('생성 이미지 상세', id), /^생성 이미지 상세 · /);
});

test('an empty id degrades to the bare kind rather than a dangling separator', () => {
  assert.equal(dialogLabel('이미지 보기', ''), '이미지 보기');
});

// ── 3. Where focus returns ────────────────────────────────────────────────────

/** Stands in for the DOM: each lookup returns whatever the test supplied. */
const fakeLookup = ({ opener = null, finalPrompt = null, galleryHeading = null } = {}) => ({
  opener: () => opener,
  finalPrompt: () => finalPrompt,
  galleryHeading: () => galleryHeading,
});

test('a plain close returns to the opener', () => {
  const opener = { isConnected: true };
  const lookup = fakeLookup({ opener, finalPrompt: { isConnected: true },
    galleryHeading: { isConnected: true } });
  assert.equal(resolveReturn({ to: 'opener' }, lookup), opener);
});

test('a successful reuse goes to the final prompt, not back to the card', () => {
  const opener = { isConnected: true };
  const finalPrompt = { isConnected: true };
  const lookup = fakeLookup({ opener, finalPrompt });
  assert.equal(resolveReturn({ to: 'final-prompt' }, lookup), finalPrompt);
});

test('an archived-away card returns to the gallery heading', () => {
  const galleryHeading = { isConnected: true };
  const lookup = fakeLookup({ galleryHeading, finalPrompt: { isConnected: true } });
  assert.equal(resolveReturn({ to: 'gallery-heading' }, lookup), galleryHeading);
});

test('a detached opener falls back instead of focusing nothing', () => {
  // The card was removed by a refresh: the node still exists in the closure but is disconnected,
  // so `focus()` on it is a no-op and the user would be left on <body>.
  const detached = { isConnected: false };
  const finalPrompt = { isConnected: true };
  const lookup = fakeLookup({ opener: detached, finalPrompt });
  assert.equal(resolveReturn({ to: 'opener' }, lookup), finalPrompt);
});

test('with every target missing the answer is null, never a silent body focus', () => {
  const lookup = fakeLookup();
  assert.equal(resolveReturn({ to: 'opener' }, lookup), null);
  assert.equal(resolveReturn({ to: 'final-prompt' }, lookup), null);
  assert.equal(resolveReturn({ to: 'gallery-heading' }, lookup), null);
});

test('the fallback chain does not return the target that was missing', () => {
  // `final-prompt` is gone but the heading exists: the heading is the answer, and asking for the
  // heading directly must not bounce back to the missing prompt.
  const galleryHeading = { isConnected: true };
  const lookup = fakeLookup({ galleryHeading });
  assert.equal(resolveReturn({ to: 'final-prompt' }, lookup), galleryHeading);
  assert.equal(resolveReturn({ to: 'gallery-heading' }, lookup), galleryHeading);
});

// ── 4. Wiring (structural only — behaviour is the browser suite's claim) ─────

test('both dialogs use the shared trap and a labelled, focusable container', () => {
  for (const [name, source] of [['ImageViewer', viewerSource], ['MetadataModal', metadataSource]]) {
    assert.match(source, /useDialogTrap/, `${name} must use the shared trap`);
    assert.match(source, /aria-label=\{dialogLabel\(/, `${name} must label the dialog with its id`);
    assert.match(source, /tabIndex=\{-1\}/, `${name} container must be able to take focus`);
    // A second, hand-rolled Escape handler would fight the trap over the same key.
    assert.doesNotMatch(source, /event\.key === "Escape"/, `${name} must not also handle Escape itself`);
  }
});

test('the viewer keeps its arrow keys and no longer owns Escape', () => {
  assert.match(viewerSource, /ArrowLeft/);
  assert.match(viewerSource, /ArrowRight/);
});

test('the gallery opener records the element that opened the dialog', () => {
  // Both openers pass `event.currentTarget`, so the ref holds the button rather than a guess.
  // UIX06A: the recording moved into `openViewer`/`openMetadata`, which also write the URL —
  // the element is still captured from the click, not looked up afterwards.
  assert.match(appSource, /function openViewer\(asset: Asset, opener: HTMLElement \| null\) \{\n    openerRef\.current = opener;/);
  assert.match(appSource, /function openMetadata\(asset: Asset, opener: HTMLElement \| null\) \{\n    openerRef\.current = opener;/);
  assert.match(appSource, /openViewer\(asset, event\.currentTarget\)/);
  assert.match(appSource, /openMetadata\(asset, event\.currentTarget\)/);
});

test('each close cause names its destination rather than a bare setState', () => {
  // The four causes required: reuse success, archive success, plain close, viewer close.
  // UIX06A: a successful restore leaves the dialog for the generate *screen*, so the destination
  // is now a navigation rather than a `returnToRef` target — `goToGenerate` sets the URL and
  // moves focus to the final prompt, which is the same promise the old target made.
  assert.match(appSource, /function goToGenerate\(\) \{/);
  assert.match(appSource, /navigate\(artPath\.generate\(\), \{ replace: true \}\)/);
  assert.match(appSource, /setFinalFocusTick\(\(tick\) => tick \+ 1\)/);
  assert.match(appSource, /returnToRef\.current = \{ to: "gallery-heading" \}/);
  assert.match(appSource, /returnToRef\.current = \{ to: "opener" \}/);
  // A failure keeps the dialog open: it must not close and lose the reason.
  assert.match(appSource, /setMetadataFailure\(/);
});

test('a restore that cannot be read reports inside the dialog and stays open', () => {
  // The old code raised a page-level error and left the dialog closed, which reads as success.
  const at = appSource.indexOf('if (!read.ok)');
  assert.ok(at > 0, 'the unreadable-record branch must still exist');
  const block = appSource.slice(at, at + 400);
  assert.match(block, /setMetadataFailure/);
  assert.doesNotMatch(block, /setError\(read\.message\)/);
});

test('the viewer derives the index from the id on every render and stores nothing', () => {
  // A stored index would survive a list refresh and point at a different image.
  assert.match(viewerSource, /assets\.findIndex\(\(asset\) => asset\.asset_id === viewedId\)/);
  assert.doesNotMatch(viewerSource, /useState<number>\(initialAssets/);
});

