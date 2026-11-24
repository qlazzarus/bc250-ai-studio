import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';
import { COMPOSE_UNSUPPORTED } from '../src/prompt/composeCapability.ts';

/**
 * UIX01: two entry points, and the unavailable-compose way out.
 *
 * Two kinds of evidence, because the task's completion criteria are two kinds of claim:
 *
 * 1. **Structure** — folding the Korean region must not unmount the panel or send a
 *    request, and the direct path must land on the field that already exists. Those are
 *    properties of the tree, so they are asserted against the source with the markers the
 *    implementation actually uses.
 * 2. **Rendered output** — the unsupported sentence and the button that leaves it have to
 *    appear together. A grep for both strings would pass even if the button rendered in a
 *    branch that never runs, so `ComposePanel` is rendered and its markup is read.
 *
 * Everything ComposePanel imports is transpiled to `data:` URLs with the repo's own
 * TypeScript, the same way `prompt-metadata-modal.test.mjs` renders its component.
 */
const here = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(here, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SRC = join(here, 'src');
const appSource = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const panelSource = readFileSync(join(SRC, 'components/ComposePanel.tsx'), 'utf8');
const builderSource = readFileSync(join(SRC, 'components/PromptBuilder.tsx'), 'utf8');

function bareSpecifier(specifier) {
  // `react/jsx-runtime` comes from the JSX transform; `react` itself is imported by the
  // component for its hooks, which `MetadataModal` did not need.
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

/** Every module specifier the transpiled code imports, read from the syntax tree. */
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

/**
 * `ComposePanel` has a wider import graph than `MetadataModal`, so the cycle cap is higher.
 * It is still finite: an accidental cycle shows up as an error instead of a hang.
 */
function moduleUrl(file) {
  const cached = transpiled.get(file);
  if (cached) return cached;
  if (transpiled.size > 80) throw new Error('import cycle');

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
    code = code.split(JSON.stringify(specifier)).join(JSON.stringify(replacement));
  }

  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  transpiled.set(file, url);
  return url;
}

async function renderPanel(props) {
  const { default: ComposePanel } = await import(moduleUrl(join(SRC, 'components/ComposePanel.tsx')));
  return renderToStaticMarkup(React.createElement(ComposePanel, {
    negativeSupported: true, prompt: '', negative: '', appliedPrompt: null,
    onApply: () => {}, target: null, ...props,
  }));
}

/** The source of one function, from its declaration to the closing brace on column 2. */
function functionBody(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf('\n  }\n', start);
  assert.ok(end > start, `${name} must have a body`);
  return source.slice(start, end);
}

test('the compose fallback keeps its reason next to the way to the English field', async () => {
  const html = await renderPanel({
    capability: { ...COMPOSE_UNSUPPORTED, support: 'absent' }, onUseDirectInput: () => {},
  });
  // The reason is unchanged: this task does not rewrite the capability contract.
  assert.match(html, /이 서버에서는 통합 생성을 사용할 수 없습니다/);
  // ...and the exit is in the same block, after the sentence that names the field.
  const block = html.slice(html.indexOf('compose-unavailable'));
  assert.ok(block.length > 0, 'the fallback and the exit share one block');
  const reason = block.indexOf('이 서버에서는 통합 생성을 사용할 수 없습니다');
  const exit = block.indexOf('최종 프롬프트 직접 입력');
  assert.ok(reason >= 0 && exit > reason, 'the exit follows the reason it answers');
  assert.match(block, /class="quiet compose-direct"/);
});

test('a supported server shows neither the reason nor the direct-input exit', async () => {
  const html = await renderPanel({
    capability: { ...COMPOSE_UNSUPPORTED, supported: true, support: 'supported',
      dictionaryVersion: '1.2.0', profileVersion: 1 },
    onUseDirectInput: () => {},
  });
  assert.doesNotMatch(html, /compose-unavailable/);
  assert.doesNotMatch(html, /통합 생성을 사용할 수 없습니다/);
});

/**
 * The exit is a focus move, never a write. If it also set the prompt, a user who cannot
 * compose could end up with text they never chose — the same failure the candidate path
 * refuses by requiring an explicit apply.
 */
test('the direct-input action only moves focus', () => {
  const handler = panelSource.match(/onClick=\{onUseDirectInput\}/g) ?? [];
  assert.equal(handler.length, 1);
  assert.doesNotMatch(panelSource, /onUseDirectInput\(\)/, 'the prop must be handed to onClick');
  assert.doesNotMatch(panelSource, /onUseDirectInput[\s\S]{0,80}(onApply|withBrief)/,
    'the exit must not write through the apply path');
});

test('the model is followed by two named paths, and the Korean region stays mounted', () => {
  const model = appSource.indexOf('<label>모델<select');
  const paths = appSource.indexOf('className="prompt-paths"');
  const region = appSource.indexOf('id="compose-path"');
  const finalPrompt = appSource.indexOf('id="prompt-final"');
  assert.ok(model > 0 && paths > model, 'the paths follow the model selector');
  assert.ok(region > paths, 'the Korean region belongs to the path group');
  assert.ok(finalPrompt > region, 'the English field is reachable after the Korean region');

  // Both entries are named by the user's outcome, not by an internal component name.
  assert.match(appSource, />한글 장면으로 만들기</);
  assert.match(appSource, />최종 프롬프트 직접 입력</);

  // Folding is `hidden`, so the panel is never unmounted and cannot resend on a toggle.
  assert.match(appSource, /hidden=\{!composePathOpen\}/);
  assert.doesNotMatch(appSource, /composePathOpen && <ComposePanel/,
    'the compose panel must not be conditionally rendered');
  assert.match(appSource, /const \[composePathOpen, setComposePathOpen\] = useState\(true\)/,
    'the Korean path is in front by default');
});

test('openPath writes no value and never calls the API', () => {
  const body = functionBody(appSource, 'openPath');
  assert.doesNotMatch(body, /setSettings/);
  assert.doesNotMatch(body, /api\./);
  assert.doesNotMatch(body, /onChange/);
  // It only decides which region is in front and where focus lands.
  assert.match(body, /setComposePathOpen\(false\)/);
  assert.match(body, /setFinalFocusTick\(\(tick\) => tick \+ 1\)/);
});

test('the direct path targets the field that already exists', () => {
  // `aria-controls` and the textarea have to name the same node, or assistive tech points
  // at nothing and the harness cannot tell the two same-named buttons apart.
  const controls = appSource.match(/aria-controls="prompt-final"/g) ?? [];
  assert.equal(controls.length, 1);
  assert.match(appSource, /<textarea id="prompt-final" ref=\{finalPromptRef\}/);
  // The focus further down the form is the only thing the path does to it.
  assert.doesNotMatch(appSource, /finalPromptRef\.current\.value/);
});

test('the dictionary panel is named as an advanced draft tool', () => {
  assert.match(builderSource, /사전 초안·고급 도구/);
  assert.doesNotMatch(builderSource, /프롬프트 구성 열기/);
  assert.doesNotMatch(builderSource, /프롬프트 구성 닫기/);
  // The restore status is outside the folded panel, so it stays readable when it is closed.
  const statusIndex = builderSource.indexOf('className="prompt-status"');
  const panelIndex = builderSource.indexOf('id="prompt-builder-panel"');
  assert.ok(statusIndex > 0 && statusIndex < panelIndex,
    'the restore status must not live inside the collapsible panel');
});
