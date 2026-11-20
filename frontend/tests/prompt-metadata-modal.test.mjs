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
 * The component is a `.tsx` module and the tests run on Node's type stripping, which does
 * not transform JSX. It is transpiled here with the repo's own TypeScript, and the
 * `react/jsx-runtime` specifier is rewritten to an absolute URL so the data: module can
 * resolve it.
 */
const here = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(here, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

async function renderMetadata(data) {
  const source = readFileSync(join(here, 'src/components/MetadataModal.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const runtime = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  const module = outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(runtime));
  const url = `data:text/javascript;base64,${Buffer.from(module).toString('base64')}`;
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
