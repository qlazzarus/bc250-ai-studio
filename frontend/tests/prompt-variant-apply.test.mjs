import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DICTIONARY } from '../src/prompt/dictionary.ts';
import { VARIANT_KIND, parseReply, revisionsFor } from '../src/prompt/llmProposals.ts';
import { selectEntry } from '../src/prompt/scene.ts';
import { variantCards } from '../src/prompt/situationVariants.ts';
import {
  applyVariantScene, recordVariantApply, undoVariantScene, variantUndoStatus,
} from '../src/prompt/variantApply.ts';

const entry = (id) => DICTIONARY.find((item) => item.id === id);

const scene = (changes = {}) => ({
  schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '같은 인물과 의상으로 다른 상황 3개', ...changes,
});

/** The approved scene every candidate in this file was written for. */
const withCast = () => {
  let next = selectEntry(scene(), entry('subject.person'), '1.2.0');
  next = selectEntry(next, entry('clothing.white_shirt'), '1.2.0');
  next = selectEntry(next, entry('location.street'), '1.2.0');
  return selectEntry(next, entry('action.standing'), '1.2.0');
};

const variant = (over = {}) => ({
  variant_id: 'v1', label_ko: '공원에서 걷기', prompt_ko: '같은 인물이 공원을 걷는다',
  changed_ids: ['setting.park', 'action.walking'], removed_ids: ['location.street', 'action.standing'],
  unresolved_ko: [], ...over,
});

const replyOf = (variants) => parseReply({
  proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: VARIANT_KIND,
  suggestions: [], variants, unresolved_spans: [], ambiguities: [], rejected: [], truncated: false,
});

const cardOf = (over = {}, context = {}) => variantCards({
  reply: replyOf([variant(over)]), scene: withCast(), dictionary: DICTIONARY, family: 'sd15', ...context,
}).cards[0];

const ids = (target) => target.selections.map((item) => item.id);

test('a candidate applies exactly the scene its diff describes', () => {
  const card = cardOf();
  assert.deepEqual(card.blocks, []);
  const applied = applyVariantScene({
    scene: withCast(), card, dictionary: DICTIONARY, dictionaryVersion: '1.2.0',
  });
  assert.ok(applied);
  assert.deepEqual(ids(applied.scene), ['subject.person', 'clothing.white_shirt', 'setting.park', 'action.walking']);
  assert.deepEqual(applied.addedIds, ['setting.park', 'action.walking']);
  assert.deepEqual(applied.removedIds, ['location.street', 'action.standing']);
  // The cast is not touched: a candidate may only swap place and action.
  assert.equal(applied.scene.selections[0].id, 'subject.person');
  assert.equal(applied.scene.freeTextKo, withCast().freeTextKo);

  // The applied entry carries the same captured mapping a picker click would store.
  const parked = applied.scene.selections.find((item) => item.id === 'setting.park');
  assert.equal(parked.mapping.status, 'mapped');
  assert.equal(parked.mapping.text, entry('setting.park').mappings.sd15.text);
});

test('a candidate that cannot be applied is refused, never partly applied', () => {
  const refuse = (changes) => {
    // A card built by an older render against a different selection: its blocks are
    // clean, so the module itself has to refuse the change.
    const card = { ...cardOf(), key: 'v:stale', changes };
    return applyVariantScene({ scene: withCast(), card, dictionary: DICTIONARY, dictionaryVersion: '1.2.0' });
  };
  const change = (id, direction) => ({ id, labelKo: id, group: 'setting', direction });

  // A blocked card is refused in the module too, not only in the DOM.
  const blocked = cardOf({ changed_ids: ['subject.dog', 'setting.park'], removed_ids: [] },
    { scope: { targetGroups: ['setting', 'pose'], lockedIds: ['subject.person'] } });
  assert.ok(blocked.blocks.length > 0);
  assert.equal(applyVariantScene({
    scene: withCast(), card: blocked, dictionary: DICTIONARY, dictionaryVersion: '1.2.0',
  }), null);

  // Adding what is already selected, or removing what is not, would be a no-op or a lie.
  assert.equal(refuse([change('location.street', 'add')]), null);
  assert.equal(refuse([change('setting.park', 'remove')]), null);

  // A duplicate inside one candidate is refused as well, never collapsed.
  assert.equal(refuse([change('setting.park', 'add'), change('setting.park', 'add')]), null);

  // An id the dictionary cannot resolve never reaches the scene.
  assert.equal(refuse([change('setting.atlantis', 'add')]), null);

  // Nothing to change at all is not an apply.
  assert.equal(refuse([]), null);
});

test('an inactive entry is refused even when the card was built before the change', () => {
  const card = cardOf();
  const disabled = DICTIONARY.map((item) => (item.id === 'setting.park' ? { ...item, active: false } : item));
  assert.equal(applyVariantScene({
    scene: withCast(), card, dictionary: disabled, dictionaryVersion: '1.2.0',
  }), null);
});

test('undo restores the exact pre-apply scene, including a removed expression', () => {
  const before = withCast();
  const card = cardOf();
  const applied = applyVariantScene({
    scene: before, card, dictionary: DICTIONARY, dictionaryVersion: '1.2.0',
  });
  const record = recordVariantApply({
    key: card.key, variantId: card.variantId, labelKo: card.labelKo, before, after: applied.scene,
  });

  // The record keeps the whole scene, so a *stored* expression the picker no longer
  // produces is restored verbatim rather than re-selected from the current dictionary.
  const legacy = {
    ...before,
    selections: before.selections.map((item) => (item.id === 'location.street'
      ? { ...item, mapping: { status: 'mapped', text: 'stored street expression' } } : item)),
  };
  const legacyApplied = applyVariantScene({
    scene: legacy, card, dictionary: DICTIONARY, dictionaryVersion: '1.2.0',
  });
  const legacyRecord = recordVariantApply({
    key: card.key, variantId: card.variantId, labelKo: card.labelKo, before: legacy, after: legacyApplied.scene,
  });
  assert.deepEqual(undoVariantScene(legacyRecord), legacy);

  // The ordinary case is the same promise: the scene is restored, not rebuilt.
  assert.deepEqual(undoVariantScene(record), before);
  assert.equal(record.labelKo, '공원에서 걷기');
  assert.equal(record.variantId, 'v1');
});

test('undo is allowed only while the scene still matches the apply', () => {
  const before = withCast();
  const card = cardOf();
  const applied = applyVariantScene({
    scene: before, card, dictionary: DICTIONARY, dictionaryVersion: '1.2.0',
  });
  const record = recordVariantApply({
    key: card.key, variantId: card.variantId, labelKo: card.labelKo, before, after: applied.scene,
  });

  const fresh = variantUndoStatus(record, revisionsFor(applied.scene));
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.label, '“공원에서 걷기” 상황 적용 되돌리기');

  // A chip the user drops after the apply moved the scene on: the undo is refused
  // rather than re-adding everything the candidate touched.
  const edited = { ...applied.scene, selections: applied.scene.selections.slice(0, 3) };
  const changed = variantUndoStatus(record, revisionsFor(edited));
  assert.equal(changed.allowed, false);
  assert.equal(changed.why, 'scene_changed');
  assert.match(changed.text, /되돌릴 수 없습니다/);

  // A text edit blocks it too: the candidate was written for the old description.
  assert.equal(variantUndoStatus(record, revisionsFor({ ...applied.scene, freeTextKo: '다른 설명' })).why,
    'scene_changed');

  // After the undo the scene is the pre-apply one again, which is its own state.
  const undone = variantUndoStatus(record, revisionsFor(before));
  assert.equal(undone.allowed, false);
  assert.equal(undone.why, 'already_undone');

  assert.equal(variantUndoStatus(null, revisionsFor(before)).why, 'no_record');
});

test('the composer requests candidates explicitly and applies them through the shared path', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/PromptBuilder.tsx', import.meta.url)), 'utf8');
  const module = readFileSync(fileURLToPath(new URL('../src/prompt/variantApply.ts', import.meta.url)), 'utf8');

  // VAR02 is reachable: a button sends `variant: true`, which is what selects the
  // `situation_variants` kind in `proposalBody`.
  assert.match(source, /requestProposal\("variant"\)/);
  assert.match(source, /variant: mode === "variant"/);
  // Applying goes through the pure module, which itself only calls the scene helpers.
  assert.match(source, /applyVariantScene\(/);
  assert.match(source, /undoVariantScene\(/);
  assert.match(source, /variantUndoStatus\(/);
  // The candidate's own scene edit stays in the one tested place, not in the component.
  assert.ok(!/selectEntry\([^)]*card/.test(source));
  assert.match(module, /selectEntry\(next, entry, dictionaryVersion\)/);
  assert.match(module, /removeEntry\(next, change\.id\)/);
  // A candidate never touches the final prompt or the stored composition.
  assert.ok(!/onChange|withAppliedDraft|draftComposition/.test(module));
});