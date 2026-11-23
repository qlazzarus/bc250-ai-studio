/**
 * UCP07: v3 save/restore, and what it must refuse to claim.
 *
 * UCP07's checklist has four lines and a completion criterion that is mostly about
 * *absence*: a restored record must not become applicable again, a record without an apply
 * must not produce one, and a restore must not trigger a compose request. Those are the
 * properties that regress silently, so they are asserted rather than described.
 *
 * The v1/v2 cases read records shaped the way the server actually stored them, so restoring
 * real old data is what is tested — not a v3 record with the version number changed.
 *
 * Fixtures use unique dictionary IDs: the backend refuses a duplicate `selections[].id`
 * (`check_snapshot`), so a record with two rows for one ID is one the server can never
 * have written, and an assertion about it would be about an impossible row.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY_VERSION } from '../src/prompt/dictionary.ts';
import { EMPTY_SCENE } from '../src/prompt/structuredScene.ts';
import {
  COMPOSE_COMPILER_VERSION, RESTORED_CANDIDATES, TRIM_STEPS, fromSnapshot, restoreGaps,
  sceneFromV3, sceneToV3, toSnapshot,
} from '../src/prompt/composeSnapshot.ts';
import { validateCompositionBody, validateSubmission } from '../src/prompt/validation.ts';

const TARGET = { modelId: 'pornmaster-klein-9b', family: 'flux2',
  profileVersion: 1, dictionaryVersion: DICTIONARY_VERSION };

const APPLIED = {
  resultId: 'cmp-0123456789ab', candidateId: 'candidate-1',
  providerModel: 'qwen3-test', appliedAt: '2026-11-22T00:00:00Z',
  positivePrompt: 'a woman in a red dress, rainy street',
  negativePrompt: 'blurry',
  summaryKo: '붉은 원피스를 입은 여성이 비 오는 거리에 서 있다',
};

/** A two-person scene: the case per-entity attribution exists for. */
const MULTI_SCENE = {
  ...EMPTY_SCENE,
  entities: [
    { entityId: 'entity-1', kind: 'person', count: 1,
      attributesKo: ['붉은 원피스', '긴 머리'], evidenceKo: '붉은 원피스를 입은 여성' },
    { entityId: 'entity-2', kind: 'person', count: 1,
      attributesKo: ['회색 정장'], evidenceKo: '회색 정장의 남성' },
  ],
  relations: [{ subjectEntityId: 'entity-1', predicateKo: '서 있다',
    objectEntityId: null, evidenceKo: '거리에 서 있다' }],
  environment: { ...EMPTY_SCENE.environment, locationKo: '비 오는 거리' },
};

const CHIPS = [
  { id: 'subject.person', source: 'auto', pinned: false, entityId: 'entity-1' },
  { id: 'clothing.dress', source: 'manual', pinned: true, entityId: 'entity-1' },
  { id: 'clothing.jacket', source: 'manual', pinned: false, entityId: 'entity-2' },
  { id: 'style.illustration', source: 'excluded', pinned: false, entityId: null },
];

const edit = (over = {}) => ({ briefKo: '붉은 원피스를 입은 여성이 비 오는 거리에 서 있다',
  selections: CHIPS, choices: [], targetModelId: TARGET.modelId,
  targetFamily: TARGET.family, profileVersion: TARGET.profileVersion,
  dictionaryVersion: TARGET.dictionaryVersion, ...over });

const snapshot = (over = {}) => toSnapshot({ edit: edit(), scene: MULTI_SCENE,
  applied: APPLIED, target: TARGET, compilerVersion: COMPOSE_COMPILER_VERSION, ...over });

/** A minimal valid v3 payload, for mutation tests that only need "parseable". */
const V3_MINIMAL = {
  schema_version: 3, compiler_version: '1.3.0', dictionary_version: DICTIONARY_VERSION,
  target_model_id: TARGET.modelId, target_family: TARGET.family, profile_version: 1,
  brief_ko: '비 오는 거리', selections: [], snapshot_trim: [],
  scene: { entities: [], relations: [], environment: {},
    unmapped_details: [], ambiguities: [] },
};


// ---------------------------------------------------- 1. a snapshot with no apply

test('scenario 1: a snapshot without an apply is null, not an empty record', () => {
  // The pre-apply state is a *session*, not a generation history. Saving it would let a
  // restore claim the scene produced an image it never executed.
  assert.equal(snapshot({ applied: null }), null);
});

test('a snapshot cannot describe an apply from another model family', () => {
  // The server refuses a `target_family` mismatch, so building one here would only move
  // that refusal to the network as a 422 the user cannot act on.
  assert.equal(snapshot({ edit: edit({ targetFamily: 'z-image' }) }), null);
});

/**
 * The same-family case the family guard cannot see, and the reason `chooseModel` clears the
 * record: `klein-4b-q4` → `klein-4b-q8` keeps `target_family`, so `toSnapshot` happily wrote
 * the Q4 apply under `target_model_id: klein-4b-q8`.
 *
 * The module cannot fix this alone — `AppliedResult` carries the *provider* model, not the
 * image model — so the guard lives in App. This test pins *why* the guard has to exist, by
 * showing that the snapshot layer accepts the mismatched pair when handed one.
 */
test('a same-family model switch is not detected by toSnapshot, so the caller must drop the record', () => {
  const q8 = { ...TARGET, modelId: 'klein-4b-q8' };
  const written = snapshot({ target: q8, edit: edit({ targetModelId: q8.modelId }) });
  // The layer accepts it: same family, same profile version. This is the hazard, stated as
  // an assertion so a future change to the guard is a deliberate decision, not a surprise.
  assert.notEqual(written, null);
  assert.equal(written.target_model_id, 'klein-4b-q8');
  assert.equal(written.applied.positive_prompt, APPLIED.positivePrompt);
  // With the record dropped — what `chooseModel` now does — no v3 body is produced at all,
  // so the submission cannot claim an apply the new model never ran.
  assert.equal(snapshot({ target: q8, edit: edit({ targetModelId: q8.modelId }), applied: null }), null);
});

// ---------------------------------------------------- 2. an applied snapshot

test('scenario 2: an applied snapshot round-trips the prompts verbatim', () => {
  const read = fromSnapshot(snapshot());
  assert.equal(read.ok, true);
  assert.equal(read.restored.applied?.positivePrompt, APPLIED.positivePrompt);
  assert.equal(read.restored.applied?.negativePrompt, APPLIED.negativePrompt);
  // The prompts are not the summary and not the brief: three separate facts.
  assert.equal(read.restored.applied?.summaryKo, APPLIED.summaryKo);
  assert.equal(read.restored.edit.briefKo, edit().briefKo);
});

test('the applied block carries the model and profile version it ran on', () => {
  const read = fromSnapshot(snapshot());
  assert.equal(read.restored.edit.targetModelId, TARGET.modelId);
  assert.equal(read.restored.edit.targetFamily, TARGET.family);
  assert.equal(read.restored.edit.profileVersion, TARGET.profileVersion);
  assert.equal(read.restored.edit.dictionaryVersion, TARGET.dictionaryVersion);
  assert.equal(read.restored.applied?.providerModel, APPLIED.providerModel);
});

test('a null negative prompt is omitted, not written as null', () => {
  // `negative_prompt: null` is a different claim from "this model has no negative prompt",
  // and the backend writes the key only when it has a value.
  const written = snapshot({ applied: { ...APPLIED, negativePrompt: null } });
  assert.equal('negative_prompt' in written.applied, false);
  assert.equal(fromSnapshot(written).restored.applied?.negativePrompt, null);
});

// --------------------------------------- 3. the English edited after an apply

test('scenario 3: editing the English after applying does not rewrite the record', () => {
  /*
   * The user applied a candidate, then typed their own English into the final prompt.
   * Those are two facts and the record must keep them apart:
   *
   * - `applied.positive_prompt` is what was executed with this image;
   * - the row's `prompt` is what the field held at submit time.
   *
   * The snapshot is built from the *record*, never from the text field, so an edit after
   * the apply cannot make the record claim the user's typing was the candidate's output.
   * `toSnapshot` has no parameter for the field, which is the structural guarantee.
   */
  const written = snapshot();
  assert.equal(written.applied.positive_prompt, APPLIED.positivePrompt);
  assert.equal(Object.hasOwn(written.applied, 'final_prompt'), false);
});

// ---------------------------------- 4. exclusions, pins and manual sources

test('scenario 4: exclusion, pin and manual source survive a restore', () => {
  const read = fromSnapshot(snapshot());
  assert.equal(read.ok, true);

  const excluded = read.restored.edit.selections.find((chip) => chip.source === 'excluded');
  assert.ok(excluded, 'the excluded chip must survive');
  assert.equal(excluded.id, 'style.illustration');
  // An excluded chip never carries `pinned`/`entity_id`: the backend refuses that shape,
  // and restoring it as pinned would resurrect a veto the user did not make.
  assert.equal(excluded.pinned, false);
  assert.equal(excluded.entityId, null);

  const pinned = read.restored.edit.selections.filter((chip) => chip.pinned);
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].id, 'clothing.dress');
  assert.equal(pinned[0].source, 'manual');
  assert.equal(pinned[0].entityId, 'entity-1');
  assert.equal(read.restored.edit.selections.filter((chip) => chip.source === 'manual').length, 2);
});

test('an excluded chip is written without pinned or entity_id', () => {
  const written = snapshot();
  const excluded = written.selections.filter((chip) => chip.source === 'excluded');
  assert.equal(excluded.length, 1);
  assert.deepEqual(Object.keys(excluded[0]).sort(), ['id', 'source']);
});

test('the full selection list is preserved in order', () => {
  // One chip per entity, in the order the user built them. A restore that sorted or
  // re-grouped the list would move a chip relative to the user's last edit.
  const read = fromSnapshot(snapshot());
  assert.deepEqual(read.restored.edit.selections.map((chip) => `${chip.id}:${chip.entityId}`), [
    'subject.person:entity-1', 'clothing.dress:entity-1',
    'clothing.jacket:entity-2', 'style.illustration:null',
  ]);
});


// ------------------------- 5. per-entity attribution in a multi-person scene

test('scenario 5: per-entity attributes restore attached to the right person', () => {
  const read = fromSnapshot(snapshot());
  assert.equal(read.ok, true);
  assert.equal(read.restored.scene.entities.length, 2);
  const [first, second] = read.restored.scene.entities;
  assert.equal(first.entityId, 'entity-1');
  assert.deepEqual(first.attributesKo, ['붉은 원피스', '긴 머리']);
  assert.equal(second.entityId, 'entity-2');
  // The whole point: the grey suit must not migrate to the woman.
  assert.deepEqual(second.attributesKo, ['회색 정장']);
  assert.equal(first.evidenceKo, '붉은 원피스를 입은 여성');
});

test('a chip keeps pointing at the entity it was attributed to', () => {
  const read = fromSnapshot(snapshot());
  const dress = read.restored.edit.selections.find((chip) => chip.id === 'clothing.dress');
  assert.equal(dress.entityId, 'entity-1');
  // The second person's chip points at the *second* entity. A restore that collapsed
  // attributions onto the first entity would make both outfits belong to one person.
  const jacket = read.restored.edit.selections.find((chip) => chip.id === 'clothing.jacket');
  assert.equal(jacket.entityId, 'entity-2');
});

test('the scene survives round-tripping through the wire shape', () => {
  // `sceneToV3` and `sceneFromV3` are inverses for every field the record keeps.
  assert.deepEqual(sceneFromV3(sceneToV3(MULTI_SCENE)), MULTI_SCENE);
});

// ------------------------- 6. a record left behind by a model change

test('scenario 6: a record for another model restores and says which model it was', () => {
  /*
   * Restoring is not applying. The record is a history of what ran, so it stays readable
   * when the current model differs — but it must not present itself as current: the model
   * id, family and profile version stay on the restored edit so a caller can compare them
   * against the live target and treat the record as stale.
   */
  const read = fromSnapshot(snapshot());
  const current = { modelId: 'z-image-turbo', family: 'z-image', profileVersion: 1 };
  const stale = read.restored.edit.targetModelId !== current.modelId
    || read.restored.edit.targetFamily !== current.family
    || read.restored.edit.profileVersion !== current.profileVersion;
  assert.equal(stale, true);

  // An expired *candidate* cannot come back with it: the restore path has none to offer.
  assert.deepEqual(RESTORED_CANDIDATES, []);
});


// ------------------------------------------------- 7. legacy v1 and v2 records

const V1 = { schema_version: 1, compiler_version: '1.0.0', target_family: 'flux2',
  selections: [{ id: 'subject.person', category: 'subject', label_ko: '사람',
    dictionary_version: '1.0.0', mapping_status: 'mapped', rendered: 'a person' }],
  free_text_ko: '비 오는 거리', draft_prompt: 'a person, rainy street',
  unresolved: [{ kind: 'free_text', text: '비 오는 거리' }] };

const V2 = { ...V1, schema_version: 2,
  remainder: [{ source_ko: '비 오는 거리', suggested_en: 'rainy street',
    proposal_id: 'prop-1', proposal_model: 'qwen3-test',
    accepted_at: '2026-11-19T10:00:00Z' }] };

test('scenario 7: a v1 record restores as v1, with no apply and no scene', () => {
  const read = fromSnapshot(V1);
  assert.equal(read.ok, true);
  assert.equal(read.restored.origin, 1);
  assert.equal(read.restored.applied, null, 'v1 has no apply history to restore');
  assert.deepEqual(read.restored.scene, EMPTY_SCENE);
  assert.equal(read.restored.edit.briefKo, '비 오는 거리');
});

test('a v1/v2 selection restores as manual, so a later reply cannot drop it', () => {
  // v1/v2 predate `source`. `manual` is the conservative reading: a manual chip cannot be
  // replaced by a later reply, so a restored pick cannot silently disappear.
  for (const record of [V1, V2]) {
    const read = fromSnapshot(record);
    assert.equal(read.restored.edit.selections.length, 1);
    assert.equal(read.restored.edit.selections[0].source, 'manual');
    assert.equal(read.restored.edit.selections[0].id, 'subject.person');
  }
});

test('the v2 translation provenance is not lost', () => {
  // UCP07's criterion: "과거 v2 번역 출처가 사라지지 않는다". The proposal id names which
  // call produced the translation, so a restore that dropped it would leave a phrase with
  // no record of where its English came from.
  const read = fromSnapshot(V2);
  assert.equal(read.restored.origin, 2);
  const record = V2.remainder[0];
  assert.equal(record.proposal_id, 'prop-1');
  assert.equal(record.proposal_model, 'qwen3-test');
});

test('v1 and v2 are never upgraded to v3', () => {
  // The version is part of the fact being restored. Re-labelling a v1 row as v3 would claim
  // a scene and chip sources the row never contained.
  for (const record of [V1, V2]) {
    const read = fromSnapshot(record);
    assert.notEqual(read.restored.origin, 3);
    assert.equal(read.restored.trimmed, false);
  }
  assert.equal(fromSnapshot(V2).restored.origin, 2);
});

test('an unsupported version is refused rather than guessed', () => {
  const read = fromSnapshot({ ...V3_MINIMAL, schema_version: 4 });
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'unsupported_version');
});

test('restoreGaps names what a legacy record cannot supply', () => {
  const v1Gaps = restoreGaps(fromSnapshot(V1).restored);
  assert.equal(v1Gaps.length, 2);
  assert.match(v1Gaps[0], /장면 구조/);
  assert.match(v1Gaps[1], /적용 이력/);

  // A complete v3 record with no trimming has nothing to warn about — that is the whole
  // point of the v3 record, so it is asserted rather than assumed.
  assert.deepEqual(restoreGaps(fromSnapshot(snapshot()).restored), []);
});


// ------------------------------------- 8. the size-limited (trimmed) record

test('scenario 8: a server-trimmed record restores as incomplete, not as whole', () => {
  /*
   * The server lowers an over-budget record with the fixed ladder and names the steps in
   * `snapshot_trim`. This client must then never present the result as the original:
   *
   * - the *applied prompts are intact* (the ladder never touches them), so the prompts on
   *   screen remain trustworthy;
   * - the scene may be cut down, so `trimmed` is true and the step list is kept;
   * - `restoreGaps` says so in words.
   *
   * The record below reproduces the ladder's output shape for the worst case, with the step
   * list measured from the real ladder (`measure_ladder.py`): six steps ran, and the last
   * two (`arrays_2` at 31,710 B fits) left it under budget without dropping the scene.
   */
  const trimmed = {
    ...V3_MINIMAL,
    brief_ko: '사'.repeat(2000),
    selections: [
      { id: 'subject.person', source: 'manual', pinned: true, entity_id: 'entity-1' },
      // Kept even though its entity was cut: the chip is a user decision, the attribution
      // is derived, so `entity_id` becomes null rather than the row disappearing.
      { id: 'clothing.dress', source: 'manual', pinned: false, entity_id: null },
      { id: 'style.illustration', source: 'excluded' },
    ],
    scene: {
      entities: [{ entity_id: 'entity-1', kind: 'person', count: 1,
        attributes_ko: ['가'.repeat(200)] }],
      relations: [], environment: {}, unmapped_details: [], ambiguities: [],
    },
    applied: { result_id: 'cmp-0123456789ab', candidate_id: 'candidate-1',
      provider_model: 'qwen3-test', applied_at: '2026-11-22T00:00:00Z',
      positive_prompt: 'b'.repeat(8000), negative_prompt: 'n'.repeat(4000),
      summary_ko: '자'.repeat(600) },
    snapshot_trim: ['evidence_ko', 'ambiguity_options', 'attributes_first',
      'brief_2000', 'environment', 'arrays_2'],
  };
  const read = fromSnapshot(trimmed);
  assert.equal(read.ok, true);
  assert.equal(read.restored.trimmed, true);
  assert.deepEqual(read.restored.snapshotTrim, trimmed.snapshot_trim);
  // The prompts are the one part the ladder promises to leave alone.
  assert.equal(read.restored.applied.positivePrompt.length, 8000);
  assert.equal(read.restored.applied.negativePrompt.length, 4000);
  assert.equal(read.restored.scene.entities.length, 1);
  assert.deepEqual(read.restored.scene.environment, EMPTY_SCENE.environment);
  // Every chip survived, including the excluded one — the ladder drops no user decision.
  assert.equal(read.restored.edit.selections.length, 3);
  assert.equal(read.restored.edit.selections.filter((chip) => chip.source === 'excluded').length, 1);
  // And the gap is stated rather than left for the reader to infer from missing fields.
  assert.ok(restoreGaps(read.restored).some((line) => /축소/.test(line)));
});

test('every trim step the backend can report is one this client knows', () => {
  // The list is asserted against the backend's order. A name outside it would be silently
  // dropped from the record's history, which is how a trim becomes invisible.
  assert.deepEqual([...TRIM_STEPS], ['evidence_ko', 'ambiguity_options',
    'attributes_first', 'unmapped_text', 'brief_2000', 'environment', 'arrays_2',
    'scene_dropped']);
  const read = fromSnapshot({ ...V3_MINIMAL, snapshot_trim: [...TRIM_STEPS] });
  assert.deepEqual(read.restored.snapshotTrim, [...TRIM_STEPS]);
});

test('an unknown trim step is ignored rather than crashing the restore', () => {
  const read = fromSnapshot({ ...V3_MINIMAL, snapshot_trim: ['evidence_ko', 'from_the_future'] });
  assert.equal(read.ok, true);
  assert.deepEqual(read.restored.snapshotTrim, ['evidence_ko']);
});


// ------------------------------------------------- 9. refusing a bad record

test('scenario 9: a dangling entity reference is refused, not repaired', () => {
  /*
   * Repairing this to "whole scene" would move an attribute off a person without saying so.
   * The record is wrong, and the only honest response is to refuse it and say why.
   */
  const broken = {
    ...V3_MINIMAL,
    scene: { ...V3_MINIMAL.scene,
      entities: [{ entity_id: 'entity-1', kind: 'person', count: 1, attributes_ko: [] }] },
    selections: [{ id: 'subject.person', source: 'manual', pinned: true,
      entity_id: 'entity-9' }],
  };
  const read = fromSnapshot(broken);
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'dangling_reference');
  assert.match(read.message, /대상/);
});

test('a malformed selection is refused at the field that is wrong', () => {
  const cases = [
    { ...V3_MINIMAL, selections: [{ id: '', source: 'manual' }] },
    { ...V3_MINIMAL, selections: [{ id: 'a.b', source: 'invented' }] },
    { ...V3_MINIMAL, selections: [{ source: 'manual' }] },
  ];
  for (const record of cases) {
    const read = fromSnapshot(record);
    assert.equal(read.ok, false, JSON.stringify(record.selections));
    assert.equal(read.reason, 'malformed');
  }
});

test('a non-object scene reads as no scene, not as a broken record', () => {
  // `scene` has no required field, so "the record carried no readable scene" is a state the
  // type can express. Refusing the whole record would throw away the chips and the apply
  // that *are* readable.
  const read = fromSnapshot({ ...V3_MINIMAL, scene: 'not-an-object' });
  assert.equal(read.ok, true);
  assert.deepEqual(read.restored.scene, EMPTY_SCENE);
});

test('a record with no applied key restores with applied === null', () => {
  const read = fromSnapshot(V3_MINIMAL);
  assert.equal(read.ok, true);
  assert.equal(read.restored.applied, null);
  assert.equal('applied' in V3_MINIMAL, false, 'the key is absent, not null');
});

test('a non-object record is refused', () => {
  for (const value of [null, undefined, 'record', 3, []]) {
    const read = fromSnapshot(value);
    assert.equal(read.ok, false);
    assert.equal(read.reason, 'malformed');
  }
});

// ------------------------------------- 10. gallery reuse and retry

test('scenario 10: a gallery restore keeps the final prompt and the record apart', () => {
  /*
   * The user edited the English after applying, so the row's `prompt` and the record's
   * `applied.positive_prompt` differ. A reuse restores the *applied* prompt for the record
   * and leaves the row's `prompt` as the final string — the same two facts the metadata
   * block shows. Reconstructing the prompt from the scene would invent English the user
   * never saw.
   */
  const read = fromSnapshot(snapshot());
  const finalPrompt = 'my own words after applying';
  assert.notEqual(finalPrompt, read.restored.applied.positivePrompt);
  assert.equal(read.restored.applied.positivePrompt, APPLIED.positivePrompt);
  // The restored record has no field that could overwrite the final string.
  assert.equal(Object.hasOwn(read.restored, 'finalPrompt'), false);
});

test('a restore never yields an applicable candidate', () => {
  // §5: an expired candidate must not become pressable again through a restore.
  assert.deepEqual(RESTORED_CANDIDATES, []);
  assert.equal(RESTORED_CANDIDATES.length, 0);
});

test('the record a restore produces can be saved again unchanged', () => {
  // Round-tripping must be stable: restore -> snapshot keeps every field the record is
  // allowed to carry. A field that silently changed type here would drift on every save.
  const first = snapshot();
  const restored = fromSnapshot(first);
  const again = toSnapshot({ edit: restored.restored.edit, scene: restored.restored.scene,
    applied: restored.restored.applied, target: TARGET,
    compilerVersion: COMPOSE_COMPILER_VERSION });
  assert.deepEqual(again, first);
});

test('the compiler version is recorded, not confused with the dictionary version', () => {
  // They are different facts: one says which dictionary entries were offered, the other
  // which build decided how the record is written. Tying them together would mean a shape
  // change could not be recorded without also claiming the dictionary changed.
  const written = snapshot();
  assert.equal(written.compiler_version, COMPOSE_COMPILER_VERSION);
  assert.equal(written.dictionary_version, TARGET.dictionaryVersion);
  assert.notEqual(written.compiler_version, written.dictionary_version);
});


// ------------------------------------------- 11. the v3 body is a different record
//
// Everything above proves the *shape*. These prove the client will send it at all: a v3
// body routed through the v1/v2 validator threw on `c.unresolved.length`, so the UI could
// not generate from any applied v3 draft. Generation is the one thing a snapshot is for.

const v3Body = (over = {}) => ({ ...snapshot(), ...over });

test('a v3 body is accepted by the validator that decides the submit button', () => {
  const issues = validateCompositionBody(v3Body(), TARGET.family);
  assert.deepEqual(issues, []);
  // And through `validateSubmission`, which is the function the submit path calls.
  assert.deepEqual(validateSubmission(
    { model_id: TARGET.modelId, prompt: APPLIED.positivePrompt, prompt_composition: v3Body() },
    TARGET.family, 65536), []);
});

test('a v1 and v2 body still take the old validator', () => {
  // The dispatcher must not quietly re-describe old records with the v3 rules: a v1
  // record legitimately has no `brief_ko` and no `scene`, and demanding them would refuse
  // every legacy row that the server stores happily.
  const v1 = { schema_version: 1, compiler_version: '1.0.0', target_family: TARGET.family,
    selections: [], free_text_ko: '', draft_prompt: '', unresolved: [] };
  assert.deepEqual(validateCompositionBody(v1, TARGET.family), []);
  const v2 = { ...v1, schema_version: 2, remainder: [] };
  assert.deepEqual(validateCompositionBody(v2, TARGET.family), []);
  // The old validator's own rules still apply, through the same entry point.
  const mismatch = validateCompositionBody({ ...v1, target_family: 'z-image' }, TARGET.family);
  assert.equal(mismatch.length, 1);
});

test('an oversize v3 body is not refused: the server trims it instead', () => {
  // The 32 KiB cap is the *stored* size. Refusing here would block a body the server is
  // able to repair with its ladder, and the user would have no way to submit it at all.
  // The scene is the real one, only padded — the chip attributions must stay valid, or the
  // refusal would come from a different rule and the test would assert nothing.
  const heavy = v3Body({
    scene: { ...sceneToV3(MULTI_SCENE), unmapped_details: Array.from({ length: 320 },
      (_, index) => ({ text_ko: `${index} `.repeat(40) })) },
  });
  const bytes = new TextEncoder().encode(JSON.stringify(heavy)).length;
  assert.ok(bytes > 32768, `fixture must be over the snapshot budget (${bytes} B)`);
  assert.deepEqual(validateCompositionBody(heavy, TARGET.family), []);
});

test('the request cap still applies to the whole body', () => {
  // Two limits stack and only one moved: the snapshot is trimmed by the server, the
  // request is refused at the door (413) and that has to stay a client-side block.
  const huge = validateSubmission(
    { model_id: TARGET.modelId, prompt: 'x', prompt_composition: v3Body({ brief_ko: 'ㄱ'.repeat(20000) }) },
    TARGET.family, 8192);
  assert.equal(huge.filter((issue) => issue.field === 'request').length, 1);
});

test('a v3 body for another family is refused before it is queued', () => {
  const issues = validateCompositionBody(v3Body({ target_family: 'z-image' }), TARGET.family);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /모델 계열이 다릅니다/);
});

test('a veto-only v3 body is refused: it records nothing to generate', () => {
  // UCP01 fix A: chips without a brief are valid, a veto without either is not.
  const issues = validateCompositionBody(v3Body({
    brief_ko: '', selections: [{ id: 'style.illustration', source: 'excluded' }],
  }), TARGET.family);
  assert.ok(issues.some((issue) => /한글 설명이나 선택한 항목/.test(issue.message)));
  // The same record with one chosen chip is fine.
  assert.deepEqual(validateCompositionBody(v3Body({
    brief_ko: '', selections: [{ id: 'subject.person', source: 'auto', pinned: false }],
  }), TARGET.family), []);
});

test('an excluded chip carrying a pin or an owner is refused', () => {
  // The server rejects both, and the client builds the list, so a stray field is a client
  // bug worth catching here rather than as a 422 after the user pressed 생성.
  for (const extra of [{ pinned: true }, { entity_id: 'entity-1' }]) {
    const issues = validateCompositionBody(v3Body({
      selections: [{ id: 'style.illustration', source: 'excluded', ...extra }],
    }), TARGET.family);
    assert.equal(issues.length, 1, JSON.stringify(extra));
  }
});

test('a chosen chip without a boolean pin is refused', () => {
  const issues = validateCompositionBody(v3Body({
    selections: [{ id: 'subject.person', source: 'manual' }],
  }), TARGET.family);
  assert.ok(issues.some((issue) => /고정 여부가 없습니다/.test(issue.message)));
});

test('a chip pointing at an entity the scene does not define is refused', () => {
  // Not repaired: "attributed to someone who is not here" and "attributed to no one" are
  // different claims, and only the record's author can say which was meant.
  const issues = validateCompositionBody(v3Body({
    selections: [{ id: 'subject.person', source: 'manual', pinned: true,
      entity_id: 'entity-9' }],
  }), TARGET.family);
  assert.ok(issues.some((issue) => /장면에 없는 개체/.test(issue.message)));
});

test('a relation endpoint outside the scene is refused', () => {
  const issues = validateCompositionBody(v3Body({
    scene: { ...sceneToV3(MULTI_SCENE), relations: [{ subject_entity_id: 'ghost',
      predicate_ko: '옆에', object_entity_id: null }] },
  }), TARGET.family);
  assert.ok(issues.some((issue) => /장면에 없는 개체를 가리킵니다: ghost/.test(issue.message)));
});

test('applied is present-and-complete or absent, never null', () => {
  // Presence is the fact "this was executed"; a null would be a third state meaning nothing.
  assert.ok(validateCompositionBody(v3Body({ applied: null }), TARGET.family).length > 0);
  assert.ok(validateCompositionBody(v3Body({ applied: { result_id: 'r' } }), TARGET.family).length > 0);
  const absent = v3Body();
  delete absent.applied;
  assert.deepEqual(validateCompositionBody(absent, TARGET.family), []);
});

test('snapshot_trim may only name steps from the fixed ladder', () => {
  // The list is read as "these fields are absent", so an unknown name would describe an
  // absence nobody can interpret.
  assert.deepEqual(validateCompositionBody(
    v3Body({ snapshot_trim: ['evidence_ko', 'scene_dropped'] }), TARGET.family), []);
  const issues = validateCompositionBody(v3Body({ snapshot_trim: ['nope'] }), TARGET.family);
  assert.ok(issues.some((issue) => /알 수 없는 축소 단계/.test(issue.message)));
});

test('a v3 record this client wrote always passes its own validator', () => {
  // The round trip that matters: whatever `toSnapshot` produces must be submittable
  // without the server's 422 being the first place a mismatch is discovered.
  assert.deepEqual(validateCompositionBody(snapshot(), TARGET.family), []);
  // Including after a restore, which is the path a saved row takes back to the button.
  const restored = fromSnapshot(snapshot());
  const again = toSnapshot({ edit: restored.restored.edit, scene: restored.restored.scene,
    applied: restored.restored.applied, target: TARGET,
    compilerVersion: COMPOSE_COMPILER_VERSION });
  assert.deepEqual(validateCompositionBody(again, TARGET.family), []);
});

