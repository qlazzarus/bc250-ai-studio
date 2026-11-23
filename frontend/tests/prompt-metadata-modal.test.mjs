import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * U12: render `MetadataModal` and read what it actually prints.
 *
 * Source greps were the only check this component had, and a grep cannot tell whether a
 * sentence ends up on screen — the "출처: 별도 기록 없음" regression lived through several
 * greps because the string was still in the file, in the branch that no longer ran.
 * Rendering is therefore the assertion: React 19 renders synchronously to a string, so no
 * DOM or browser is needed.
 *
 * The component is TSX and the tests run on Node's own type stripping, which does not
 * transform JSX — and which also rejects constructs such as parameter properties, so it
 * cannot load `api.ts` even though no JSX is involved. The component and everything it
 * imports are therefore transpiled here with the repo's own TypeScript, and each module is
 * turned into a `data:` URL. A `data:` URL has no directory, so relative specifiers cannot
 * be resolved from it; they are replaced with the `data:` URLs of the transpiled imports,
 * depth first. The graph below is small and acyclic, which is what makes that enough.
 */
const here = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(here, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SRC = join(here, 'src');

/** Bare specifiers the modules may use, mapped to absolute URLs. */
function bareSpecifier(specifier) {
  if (specifier === 'react/jsx-runtime') return pathToFileURL(require.resolve('react/jsx-runtime')).href;
  return null;
}

/** Extension-less relative specifiers, resolved the way the bundler would. */
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

const transpiled = new Map();

/**
 * Every module specifier the transpiled `code` actually imports.
 *
 * Parsed rather than matched: a regex for `from "…"` also hits the phrase
 * `from "applied, but we forgot the prompt"` inside a JSDoc comment, and silently
 * rewriting prose is exactly the kind of failure this test exists to catch.
 */
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

/**
 * Transpile `file` and every module it imports into a `data:` URL, imports first.
 *
 * Type-only imports are erased by the transpiler, so they never reach the resolver — which
 * matters because `structuredScene.ts` names `./dictionary` for its types alone.
 */
function moduleUrl(file) {
  const cached = transpiled.get(file);
  if (cached) return cached;
  if (transpiled.size > 32) throw new Error('import cycle');

  const source = readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
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
    // Quotes are part of the pattern so the specifier cannot match inside a longer path.
    code = code.split(JSON.stringify(specifier)).join(JSON.stringify(replacement));
  }

  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  transpiled.set(file, url);
  return url;
}

async function renderMetadata(data) {
  const url = moduleUrl(join(SRC, 'components/MetadataModal.tsx'));
  const { default: Metadata } = await import(url);
  return renderToStaticMarkup(React.createElement(Metadata, {
    data, archived: false, close: () => {}, reuse: () => {},
    changeArchive: async () => {}, destroy: async () => {},
  }));
}


const base = {
  asset_id: 'asset-1', model_id: 'fake', prompt: 'a person', negative_prompt: '',
  width: 64, height: 64, steps: 4, cfg_scale: 1, seed: 1, batch_index: 0,
  simulated: true, preset: 'balanced', sampling_method: null, scheduler: null,
};

const compositionV1 = {
  schema_version: 1, compiler_version: '1.3.0', target_family: 'sd15',
  selections: [{ id: 'subject.person', category: 'subject', label_ko: '인물', dictionary_version: '1.2.0',
    mapping_status: 'unavailable', rendered: null }],
  free_text_ko: '비 오는 거리', draft_prompt: 'a person', unresolved: [],
};

const remainder = [{
  source_ko: '비 오는 밤', suggested_en: 'a rainy night', proposal_id: 'prop-0123456789',
  proposal_model: 'qwen-test', accepted_at: '2026-11-19T10:00:00Z',
}];

test('a v2 record shows the included translations with their provenance', async () => {
  const html = await renderMetadata({
    ...base, prompt: 'a person\na rainy night',
    prompt_composition: { ...compositionV1, schema_version: 2, remainder },
  });
  // The list itself, phrased as what it is: the reason the final string differs.
  assert.match(html, /포함한 번역 \(최종 문자열 끝에 줄바꿈으로 붙음\)/);
  assert.match(html, /비 오는 밤 → a rainy night/);
  // Each provenance field is printed, not summarised away.
  assert.match(html, /번역 출처: qwen-test/);
  assert.match(html, /번역 제안 prop-0123456789/);
  assert.match(html, /수락 2026-11-19T10:00:00Z/);
  // The difference is attributed to the recorded translations, not left unexplained.
  assert.match(html, /차이는 아래에 기록된 포함 번역이며, 초안 자체는 번역을 흡수하지 않습니다/);
  // The regression: no claim that no provenance was recorded.
  assert.doesNotMatch(html, /경고·출처: 별도 기록 없음/);
  assert.match(html, /포함한 번역은 위 목록이 기록입니다/);
});

test('a v1 record keeps its original wording and claims no translation provenance', async () => {
  const html = await renderMetadata({ ...base, prompt_composition: compositionV1 });
  // v1 wording is untouched: nothing about translations is invented for a v1 record.
  assert.doesNotMatch(html, /포함한 번역/);
  assert.match(html, /자유 입력 반영 방식·적용 당시 문자열·당시 경고·출처: 별도 기록 없음/);
  assert.match(html, /스키마 v1/);
});

test('a v2 record whose prompt equals the draft does not blame the translations', async () => {
  // The draft-vs-final sentence is decided by string equality first, so a v2 record that
  // happens to match must not claim the difference came from translations.
  const html = await renderMetadata({
    ...base, prompt: compositionV1.draft_prompt,
    prompt_composition: { ...compositionV1, schema_version: 2, remainder },
  });
  assert.match(html, /저장된 초안과 최종 문자열이 같습니다/);
  assert.match(html, /스키마 v2/);
});
