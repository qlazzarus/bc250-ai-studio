/**
 * LLM-R02: regenerate `config/prompt_dictionary.json` from the TypeScript source.
 *
 * `frontend/src/prompt/dictionary.ts` is the only place the dictionary is authored.
 * The server needs a read-only mirror to validate proposal IDs and to show the model
 * a catalogue; it must never be hand-edited. Run this after any dictionary change:
 *
 *   node --experimental-strip-types scripts/gen-prompt-dictionary.mjs
 *
 * `backend/tests/test_proposal_api.py` re-derives the same fields from the TypeScript
 * source and fails when the committed file drifts, so a forgotten run is a test
 * failure rather than a silent difference between the browser and the server.
 *
 * What is mirrored, and why:
 *   - `id`        — the whitelist. A proposal naming anything else is rejected.
 *   - `category`  — the stored category, used for validation and display grouping.
 *   - `active`    — whether the entry may be proposed at all.
 *   - `label_ko`  — the Korean label the model needs to connect user text to an ID.
 *   - `aliases`   — the other Korean phrases the browser matches on (LLM-R02).
 *
 * `label_ko`/`aliases` are *search vocabulary*, not rendered expressions. The final
 * prompt is still assembled only by `compileScene` from `mappings`, which stays in
 * the browser and is deliberately not mirrored.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DICTIONARY, DICTIONARY_VERSION } from "../frontend/src/prompt/dictionary.ts";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../config/prompt_dictionary.json");

const entries = DICTIONARY.map((entry) => ({
  id: entry.id,
  category: entry.category,
  active: entry.active,
  label_ko: entry.labelKo,
  aliases: [...entry.aliases],
}));

const payload = {
  dictionary_version: DICTIONARY_VERSION,
  source: "frontend/src/prompt/dictionary.ts",
  active_entries: entries.filter((entry) => entry.active).length,
  entries,
};

// One entry per line: a hand-readable diff when an alias changes, and no 500-line
// churn every time the pretty-printer decides to break an array differently.
const body = entries.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n");
const text = [
  "{",
  `  "dictionary_version": ${JSON.stringify(payload.dictionary_version)},`,
  `  "source": ${JSON.stringify(payload.source)},`,
  `  "active_entries": ${payload.active_entries},`,
  '  "entries": [',
  body,
  "  ]",
  "}",
  "",
].join("\n");

// `--stdout` prints instead of writing, so the drift test can compare against the
// generator itself rather than re-implementing this file's format.
if (process.argv.includes("--stdout")) {
  process.stdout.write(text);
} else {
  writeFileSync(target, text, "utf-8");
  console.log(
    `wrote ${target}: ${entries.length} entries (${payload.active_entries} active)`);
}