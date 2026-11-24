/**
 * UIX02: reading many chips without losing track of which one you are editing.
 *
 * The task's claims are of two kinds, so the evidence is too:
 *
 * 1. **Display rules** — counts, grouping, and the fact that grouping is *display only*.
 *    These are pure functions over the edit state, so they are tested directly, including
 *    the invariant that the state array's order and the wire body are unchanged.
 * 2. **Panel structure** — the counts have to survive the fold, and the detail controls
 *    have to sit inside the chip they edit. Those are properties of the rendered tree, so
 *    `ComposePanel` is rendered and its markup read (same transpile trick as UIX01).
 *
 * Nothing here re-tests the UCP state transitions themselves (`prompt-ucp02`/`ucp06` own
 * those); it only asserts that this task's layer sits on top of them without moving them.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';
import { DICTIONARY, DICTIONARY_VERSION } from '../src/prompt/dictionary.ts';
import { chipList, groupChips } from '../src/prompt/composeChips.ts';
import { EMPTY_EDIT, exclusionClashes } from '../src/prompt/structuredScene.ts';
import { buildComposeBody } from '../src/prompt/composeRequest.ts';

const here = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(here, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SRC = join(here, 'src');
const panelSource = readFileSync(join(SRC, 'components/ComposePanel.tsx'), 'utf8');
const stylesSource = readFileSync(join(SRC, 'styles.css'), 'utf8');

const TARGET = { modelId: 'pornmaster-klein-9b', family: 'flux2',
  profileVersion: 1, dictionaryVersion: DICTIONARY_VERSION };

const edit = (changes = {}) => ({ ...structuredClone(EMPTY_EDIT),
  targetModelId: TARGET.modelId, targetFamily: TARGET.family,
  profileVersion: TARGET.profileVersion, dictionaryVersion: TARGET.dictionaryVersion,
  ...changes });

const chip = (id, over = {}) => ({ id, source: 'auto', pinned: false, entityId: null, ...over });

/** A two-person scene: `인물 1` and `인물 2`, which is the case UIX02 must disambiguate. */
const TWO_PEOPLE = {
  entities: [
    { entityId: 'entity-1', kind: 'person', count: 1, attributesKo: [], evidenceKo: null },
    { entityId: 'entity-2', kind: 'person', count: 1, attributesKo: [], evidenceKo: null },
  ],
  relations: [],
  environment: { locationKo: null, timeKo: null, lightingKo: null,
    compositionKo: null, styleKo: null, moodKo: null },
  unmappedDetails: [],
  ambiguities: [],
};

const ONE_PERSON = { ...TWO_PEOPLE, entities: [TWO_PEOPLE.entities[0]] };

/** A few real dictionary IDs, so `chipView` resolves labels and categories. */
const ids = DICTIONARY.slice(0, 6).map((entry) => entry.id);
assert.ok(ids.length >= 6, 'the dictionary must have at least six entries');

const listFor = (selections, scene = TWO_PEOPLE, family = TARGET.family) =>
  chipList({ selections }, DICTIONARY, family, scene);

const entityLabelsOf = (scene) => new Map(scene.entities.map((entity, index) =>
  [entity.entityId, `${entity.kind === 'person' ? '인물' : entity.kind} ${index + 1}`]));

test('a single-subject scene keeps one flat group with no heading', () => {
  const chips = listFor([
    chip(ids[0], { entityId: 'entity-1' }),
    chip(ids[1]),
  ], ONE_PERSON);
  const groups = groupChips(chips.chosen, entityLabelsOf(ONE_PERSON), ONE_PERSON.entities.length);
  assert.equal(groups.length, 1);
  // No heading: one list under one heading is noise, and the label being empty is the
  // signal the renderer uses to omit the `h4`.
  assert.equal(groups[0].label, '');
  assert.deepEqual(groups[0].chips.map((item) => item.id), chips.chosen.map((item) => item.id));
});

test('a multi-subject scene groups by attribution and names each group', () => {
  const chips = listFor([
    chip(ids[0], { entityId: 'entity-2' }),
    chip(ids[1], { entityId: 'entity-1' }),
    chip(ids[2], { entityId: 'entity-2' }),
    chip(ids[3]),
  ], TWO_PEOPLE);
  const groups = groupChips(chips.chosen, entityLabelsOf(TWO_PEOPLE), 2);

  // Order of first appearance is preserved, and the whole-scene bucket comes last because
  // that is where its first chip appeared — never reordered by group name.
  assert.deepEqual(groups.map((group) => group.label), ['인물 2', '인물 1', '장면 전체']);
  assert.deepEqual(groups.map((group) => group.chips.map((item) => item.id)),
    [[ids[0], ids[2]], [ids[1]], [ids[3]]]);
  // Every chosen chip appears exactly once across the groups: grouping may not drop or
  // duplicate a selection.
  const flat = groups.flatMap((group) => group.chips.map((item) => item.id)).sort();
  assert.deepEqual(flat, [ids[0], ids[1], ids[2], ids[3]].sort());
});

test('grouping never reorders or rewrites the edit state or the request body', () => {
  const selections = [
    chip(ids[0], { entityId: 'entity-2', pinned: true }),
    chip(ids[1], { entityId: 'entity-1', source: 'manual' }),
    chip(ids[2], { source: 'excluded' }),
    chip(ids[3], { entityId: 'entity-2' }),
  ];
  const state = edit({ briefKo: '두 사람이 마주 본다', selections });
  const before = JSON.stringify(state.selections);

  const chips = chipList(state, DICTIONARY, TARGET.family, TWO_PEOPLE);
  const groups = groupChips(chips.chosen, entityLabelsOf(TWO_PEOPLE), 2);
  assert.ok(groups.length > 1, 'the fixture must actually group');

  // The state is untouched by display work, and so is the serialized body.
  assert.equal(JSON.stringify(state.selections), before);
  const body = buildComposeBody({ edit: state, target: TARGET,
    requestId: 'cmp-0123456789ab', candidateCount: 3 });
  assert.equal(body.ok, true);
  // Order comes from `edit.selections`, not from the display groups: excluded row included.
  assert.deepEqual(body.body.selections.map((item) => item.id),
    [ids[0], ids[1], ids[2], ids[3]]);
  assert.deepEqual(body.body.selections[0],
    { id: ids[0], source: 'auto', pinned: true, entity_id: 'entity-2' });
});

test('the counts the bar shows come from the same lists the panel renders', () => {
  const chips = listFor([
    chip(ids[0], { pinned: true }),
    chip(ids[1], { source: 'manual' }),
    chip(ids[2], { source: 'excluded' }),
    chip(ids[3], { source: 'excluded' }),
  ]);
  assert.equal(chips.chosen.length, 2);
  assert.equal(chips.excluded.length, 2);
  assert.equal(chips.pinned, 1);
  // The badge list is what the panel renders, so counting through it cannot drift from it.
  const pinnedBadges = chips.chosen.filter((item) => item.badges.includes('고정'));
  assert.deepEqual(pinnedBadges.map((item) => item.id), [ids[0]]);
});

test('unresolved clashes are counted from the brief, not stored', () => {
  // `exclusionClashes` is derived, so the bar's number follows the text without a write.
  const base = edit({ selections: [chip(ids[0], { source: 'excluded' })] });
  const entry = DICTIONARY.find((item) => item.id === ids[0]);
  const mentions = [entry.labelKo, ...entry.aliases][0];
  const quiet = exclusionClashes({ ...base, briefKo: '관계 없는 문장' }, DICTIONARY);
  const clashing = exclusionClashes({ ...base, briefKo: `다시 ${mentions} 이야기` }, DICTIONARY);
  assert.equal(quiet.length, 0, 'an unrelated brief has no clash');
  assert.equal(clashing.length, 1, 'naming the vetoed concept is a clash');
  // Derived, so the state itself carries no clash field at all.
  assert.equal('clashes' in base, false);
});

// ── Rendered panel: the fold must not hide the numbers, and controls stay inside their chip

function bareSpecifier(specifier) {
  if (specifier === 'react/jsx-runtime') return pathToFileURL(require.resolve('react/jsx-runtime')).href;
  if (specifier === 'react') return pathToFileURL(require.resolve('react')).href;
  return null;
}

function resolveRelative(fromFile, specifier) {
  const target = resolve(join(fromFile, '..'), specifier);
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, join(target, 'index.ts')]) {
    try {
      return readFileSync(candidate) ? candidate : null;
    } catch {
      continue;
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`);
}

function specifiersOf(code) {
  const file = ts.createSourceFile('module.js', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const found = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) found.push(specifier.text);
    }
  }
  return found;
}

const transpiled = new Map();

function moduleUrl(file) {
  const cached = transpiled.get(file);
  if (cached) return cached;
  if (transpiled.size > 80) throw new Error('import cycle');
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
    },
  });
  let code = outputText;
  for (const specifier of specifiersOf(outputText)) {
    const replacement = specifier.startsWith('.')
      ? moduleUrl(resolveRelative(file, specifier))
      : bareSpecifier(specifier);
    if (replacement === null) throw new Error(`unexpected bare import ${specifier} in ${file}`);
    code = code.split(JSON.stringify(specifier)).join(JSON.stringify(replacement));
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  transpiled.set(file, url);
  return url;
}

async function renderPanel(props = {}) {
  const { default: ComposePanel } = await import(moduleUrl(join(SRC, 'components/ComposePanel.tsx')));
  return renderToStaticMarkup(React.createElement(ComposePanel, {
    negativeSupported: true, prompt: '', negative: '', appliedPrompt: null,
    onApply: () => {}, target: null,
    capability: { supported: false, support: 'absent', timeoutMs: 1000,
      dictionaryVersion: DICTIONARY_VERSION, profileVersion: 0 },
    ...props,
  }));
}

test('the rendered counts bar names all four numbers', async () => {
  const html = await renderPanel();
  assert.match(html, /aria-label="선택 요약"/);
  // Zero is shown, not hidden: "0개" is a fact the user can act on, and an absent chip
  // would look like the feature failed to render.
  for (const label of ['선택', '고정', '제외', '미해결 충돌']) {
    assert.ok(html.includes(label), `the bar must name "${label}"`);
  }
  assert.match(html, /data-kind="chosen"/);
  assert.match(html, /data-kind="excluded"/);
  assert.match(html, /data-kind="clashes"/);
});

test('the counts bar is rendered outside the collapsible dictionary', () => {
  const countsAt = panelSource.indexOf('className="compose-counts"');
  const dictionaryAt = panelSource.indexOf('id="compose-dictionary"');
  assert.ok(countsAt > 0, 'the counts bar must exist');
  assert.ok(dictionaryAt > countsAt, 'the counts bar must be emitted before the fold');
  // `#compose-dictionary` is mounted by `{panelOpen && …}`, so everything inside it
  // disappears when the panel is closed. The bar must also not depend on a draft or a
  // candidate list, or it would vanish for exactly the user who has not generated yet.
  const sceneAt = panelSource.indexOf('className="compose-scene"');
  const resultsAt = panelSource.indexOf('className="compose-results"');
  assert.ok(countsAt < sceneAt && countsAt < resultsAt,
    'the bar must not depend on a draft or a candidate list to exist');
});

test('the search count and the selection count are separate statements', () => {
  // Both numbers are on screen at once while the dictionary is open, so they are labelled
  // differently ("검색 결과 n개" vs "선택 n개") instead of two bare counts.
  assert.match(panelSource, /검색 결과 \{options\.length\}개 · 선택 \{counts\.chosen\}개/);
  assert.match(panelSource, /className="compose-meta compose-search-count"/);
});

test('a chip keeps its name and source ahead of its controls', () => {
  const headAt = panelSource.indexOf('className="compose-chip__head"');
  const actionsAt = panelSource.indexOf('className="compose-chip__actions"');
  assert.ok(headAt > 0 && actionsAt > headAt, 'name/source must render before the controls');
  // The controls are grouped and labelled with the chip's own name, so a screen reader
  // announces which chip a press belongs to.
  assert.match(panelSource, /className="compose-chip__actions" role="group"/);
  assert.match(panelSource, /aria-label=\{`\$\{chip\.labelKo\} 조작`\}/);
});

test('grouping is by attribution only when the scene has several subjects', () => {
  assert.match(panelSource, /chipGroups\.map\(\(chipGroup\)/);
  assert.match(panelSource, /\{chipGroup\.label && <h4 className="compose-chip-group__heading">/);
  assert.match(panelSource,
    /const chipGroups = groupChips\(chips\.chosen, entityLabels, entities\.length\)/);
});

test('panel, search and detail state stay local and never enter the edit', () => {
  // These are the only new interactions. Each is local view state: a write into
  // `ComposeEdit` would change `composeRevisions` and invalidate the candidates on screen.
  for (const local of ['panelOpen', 'query', 'group']) {
    assert.match(panelSource, new RegExp(`const \\[${local}, set`),
      `${local} must be local useState`);
    assert.doesNotMatch(panelSource, new RegExp(`withBrief\\(current, [^)]*${local}`),
      `${local} must not be written into the brief`);
  }
  // Every edit-writing handler routes through `update(...)`; none of them may touch layout.
  const updates = panelSource.match(/update\(\(current\) => [\s\S]{0,120}?\n/g) ?? [];
  assert.ok(updates.length > 0, 'the panel must write edits through `update`');
  for (const call of updates) {
    assert.doesNotMatch(call, /setPanelOpen|setQuery\(|setGroup\(/,
      'layout state must not travel through `update`');
  }
  // Opening the panel / searching / expanding detail must not send: `runSend` is only
  // reachable for the current edit or an answered one.
  const sends = panelSource.match(/void runSend\([^)]*\)/g) ?? [];
  assert.ok(sends.length > 0, 'generate and retry must still reach the transport');
  for (const call of sends) {
    assert.match(call, /void runSend\((?:edit|next)\)/,
      'a request may only be sent for the current or answered edit');
  }
});

test('a chip card is keyed and addressed by its chip id, not by position', () => {
  // React `key` must be the stable chip id: a position key would make React reuse a card's
  // DOM for a *different* chip when attribution moves one between groups, which silently
  // carries the old expand/pin styling onto the new chip.
  assert.match(panelSource, /className="compose-chip" key=\{chip\.id\}/);
  // The same id is on the DOM so a harness (and a bug report) can name the card it means.
  assert.match(panelSource, /data-chip-id=\{chip\.id\}/);
  // Controls are scoped inside the card and labelled with that chip's own name.
  assert.match(panelSource, /aria-label=\{`\$\{chip\.labelKo\} 조작`\}/);
});

test('the styles keep the 44px floor reachable inside the new chip card', () => {
  // The controls moved one level down; a `>` selector would silently stop applying and the
  // UCP08 responsive checks would fail at every width.
  assert.match(stylesSource, /\.compose-chip button \{ min-width: 44px; min-height: 44px;/);
  // And the counts must be able to wrap rather than overflow a 360px column.
  assert.match(stylesSource, /\.compose-counts \{ display: flex; flex-wrap: wrap;/);
});
