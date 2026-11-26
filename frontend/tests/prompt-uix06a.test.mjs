/**
 * UIX06A: the URL → screen mapping, and the guarantees the router must not break.
 *
 * `lib/routes.ts` is pure, so every claim about a path is checked without a browser. The two
 * structural checks at the end read `App.tsx` and `main.tsx` for the properties a unit test
 * cannot observe from a pure function: that the editor is not remounted by a route change, and
 * that the router wraps `App` rather than replacing it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artPath, galleryFallback, pageFromSearch, parseArtRoute,
} from '../src/lib/routes.ts';

const here = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(here, 'src');
const appSource = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const mainSource = readFileSync(join(SRC, 'main.tsx'), 'utf8');

test('every documented screen has an address, and it reads back to that screen', () => {
  const cases = [
    [artPath.overview(), 'overview'],
    [artPath.compose(), 'compose'],
    [artPath.generate(), 'generate'],
    [artPath.jobs(), 'jobs'],
    [artPath.gallery(), 'gallery'],
  ];
  for (const [path, screen] of cases) {
    const route = parseArtRoute(path);
    assert.equal(route.screen, screen, path);
    assert.equal(route.known, true, path);
  }
});

test('a job and an image address carry the id the server gave, not an index', () => {
  const job = parseArtRoute('/art/jobs/abc123');
  assert.equal(job.screen, 'jobs');
  assert.equal(job.jobId, 'abc123');
  assert.equal(job.imageId, null);

  const image = parseArtRoute('/art/gallery/img-9');
  assert.equal(image.screen, 'gallery');
  assert.equal(image.imageId, 'img-9');
  assert.equal(image.metadata, false);

  const meta = parseArtRoute('/art/gallery/img-9/metadata');
  assert.equal(meta.imageId, 'img-9');
  assert.equal(meta.metadata, true, 'the same image, with the generation dialog open');
});

test('an id is decoded once, so a percent-encoded id round-trips', () => {
  assert.equal(parseArtRoute(artPath.job('a b/c')).jobId, 'a b/c');
  assert.equal(parseArtRoute(artPath.image('a b/c')).imageId, 'a b/c');
  // A malformed escape names nothing; it must not throw during render.
  assert.equal(parseArtRoute('/art/jobs/%E0%A4%A').jobId, '%E0%A4%A');
});

test('a trailing slash is the same address', () => {
  assert.equal(parseArtRoute('/art/jobs/').screen, 'jobs');
  assert.equal(parseArtRoute('/art/gallery/x/').imageId, 'x');
  assert.equal(parseArtRoute('/art/').screen, 'overview');
});

test('reserved service paths are never Art screens', () => {
  for (const path of ['/api', '/api/v1/jobs', '/llm', '/llm/', '/llm/api/health']) {
    const route = parseArtRoute(path);
    assert.equal(route.known, false, `${path} is another app's address`);
  }
});

test('an unknown path is unknown rather than a silent gallery', () => {
  for (const path of ['/art/nope', '/art/jobs/a/b', '/art/gallery/x/y/z', '/elsewhere']) {
    assert.equal(parseArtRoute(path).known, false, path);
  }
});

test('the page comes from the query, and a bad value is page 0 rather than a neighbour', () => {
  assert.equal(parseArtRoute('/art/jobs', '?page=3').page, 3);
  assert.equal(parseArtRoute('/art/jobs', '?page=0').page, 0);
  for (const bad of ['?page=-1', '?page=abc', '?page=1.5', '?page=', '']) {
    assert.equal(pageFromSearch(bad), 0, `${bad} names no page this list has`);
  }
});


test('the archived filter is a shareable query, not a screen of its own', () => {
  const archived = parseArtRoute('/art/gallery', '?archived=1');
  assert.equal(archived.screen, 'gallery');
  assert.equal(archived.archived, true);
  assert.equal(parseArtRoute('/art/gallery').archived, false);
  // It survives a page in the same address.
  const both = parseArtRoute('/art/gallery', '?page=2&archived=1');
  assert.equal(both.page, 2);
  assert.equal(both.archived, true);
});

test('page 0 is left out of the URL, and the archived flag composes with it', () => {
  assert.equal(artPath.jobs(0), '/art/jobs');
  assert.equal(artPath.jobs(2), '/art/jobs?page=2');
  assert.equal(artPath.gallery(), '/art/gallery');
  assert.equal(artPath.gallery({ archived: true }), '/art/gallery?archived=1');
  assert.equal(artPath.gallery({ page: 1, archived: true }), '/art/gallery?page=1&archived=1');
});

test('the dialog fallback is the gallery, with the filter preserved', () => {
  assert.equal(galleryFallback(), '/art/gallery');
  assert.equal(galleryFallback({ archived: true }), '/art/gallery?archived=1');
});

test('the router wraps App, so the session it owns is never remounted by a route change', () => {
  assert.match(mainSource, /<BrowserRouter>/);
  assert.match(mainSource, /<App \/>/);
  // Hash routing was explicitly ruled out: the addresses must be real paths.
  assert.doesNotMatch(mainSource, /HashRouter/);
});

test('the editor is hidden by the route, never keyed or conditionally unmounted', () => {
  // `hidden` keeps the panel mounted, which is what preserves the compose session, the request
  // in flight and the receipt across navigation.
  assert.match(appSource, /className="panel composer" hidden=/);
  assert.match(appSource, /className="panel jobs" hidden=/);
  assert.match(appSource, /className="panel gallery" hidden=/);
  // A route-derived React key would remount the tree and cancel a running request.
  assert.doesNotMatch(appSource, /key=\{route\./);
  assert.doesNotMatch(appSource, /key=\{location\./);
});

test('the four startup reads settle independently, so one failure cannot blank the others', () => {
  // The bug this guards: `Promise.all` rejected the batch, so a failing /jobs discarded a good
  // /models reply and the generate form stayed disabled until the next poll.
  assert.match(appSource, /settle\(api\.status\(/);
  assert.match(appSource, /settle\(api\.models\(/);
  assert.match(appSource, /settle\(api\.jobs\(/);
  assert.match(appSource, /settle\(api\.assets\(/);
  assert.match(appSource, /if \(modelsRead\.ok\) \{/);
  assert.match(appSource, /if \(jobsRead\.ok\) applyJobs\(jobsRead\.value, token\)/);
});
