import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { connectBrowser, pageClient } from "./driver.mjs";
import { runSuite } from "./suite.mjs";

const CHROME = process.env.CHROME_PATH
  || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
// A throwaway profile per run: reusing one leaves a live renderer that answers CDP
// but never navigates, which looks like a suite failure.
const PROFILE = process.env.CHROME_PROFILE || mkdtempSync(join(tmpdir(), "pc-gap4-profile-"));
const PORT = Number(process.env.CDP_PORT || 9351);
// Required on purpose: no default target, so a run can never hit a server that was
// not started by serve.sh with fake models.
const APP = process.env.APP_URL;
const SHOTS = process.env.SHOT_DIR || "docs/evidence/prompt-composer-gap04";
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, expected, actual) {
  const pass = typeof expected === "function" ? expected(actual) : expected === actual;
  results.push({ name, pass, expected: String(expected).slice(0, 200), actual: JSON.stringify(actual)?.slice(0, 400) });
  console.log(`${pass ? "PASS" : "FAIL"} · ${name} · ${JSON.stringify(actual)?.slice(0, 200)}`);
  return pass;
}
const record = (name, detail) => {
  results.push({ name, pass: null, detail: String(detail).slice(0, 800) });
  console.log(`INFO · ${name} · ${String(detail).slice(0, 400)}`);
};

const main = async () => {
  if (!existsSync(CHROME)) throw new Error(`chromium not found at ${CHROME}; set CHROME_PATH`);
  if (!APP) throw new Error("APP_URL is required (e.g. APP_URL=http://localhost:4206/)");
  // Refuse to label a fake-engine run as a live one. Without this, a suite that stubs the
  // reply in the page could be re-run with EVIDENCE_LLM set and the artefact would then
  // claim live-model evidence for stubs — which is the failure mode LIVE02 exists to avoid.
  const engine = process.env.EVIDENCE_ENGINE || "fake";
  const llm = process.env.EVIDENCE_LLM || "stubbed in page";
  if (engine === "fake" && !/^(stub|stubbed|none)/i.test(llm)) {
    throw new Error(`refusing to record "${llm}" against the fake engine: `
      + "this harness stubs the proposal reply in the page and never calls a provider. "
      + "Live-model evidence must come from LIVE02 with a real STUDIO_ADMISSION_URL.");
  }
  // Provenance first, so results.json can never be read as a live-model result.
  record("증거 출처", JSON.stringify({
    engine, llm,
    storage: "real sqlite in the disposable STUDIO_DATA_DIR",
    app: APP,
    claim: "storage/http/dom only; translation quality is NOT measured here",
  }));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"],
  { stdio: "ignore" });
  let version;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; }
    catch { await sleep(250); }
  }
  if (!version) throw new Error("chromium did not expose CDP");
  console.log("browser:", version.Browser);
  const browser = connectBrowser(version.webSocketDebuggerUrl);
  await browser.ready;
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = pageClient(browser.sendTo, sessionId);
  await page.call("Page.enable");
  await page.call("Runtime.enable");
  // The app holds its bearer token in the bundle/env, not in a readable global, so
  // tests that need to call the API directly capture the header the app itself
  // sends. Without it a bare fetch returns 401 and the check would silently pass as
  // "unverified" rather than proving the retry path.
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = window.fetch;
    window.fetch = (input, init) => {
      try {
        const headers = (init && init.headers) || {};
        const auth = headers.Authorization || headers.authorization;
        if (auth) window.__authHeader = auth;
      } catch { /* ignore */ }
      return real(input, init);
    };
  })();` });
  await page.viewport(1280, 900);
  await page.call("Page.navigate", { url: APP });
  await page.waitFor("!!document.querySelector('.prompt-builder > .quiet')", { label: "app mount" });
  try {
    await runSuite({ page, browser, sessionId, check, record, sleep, shots: SHOTS, app: APP });
  } catch (error) {
    record("suite error", error.message);
    results.push({ name: "suite error", pass: false, actual: error.message });
  }
  await browser.send("Browser.close").catch(() => {});
  chrome.kill();
  if (!process.env.CHROME_PROFILE) rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const failed = results.filter((item) => item.pass === false).length;
  const resultFile = process.env.RESULT_FILE || join(SHOTS, "results.json");
  mkdirSync(dirname(resultFile), { recursive: true });
  writeFileSync(resultFile, JSON.stringify(results, null, 2));
  console.log(`\nchecks: ${results.filter((item) => item.pass !== null).length}, failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
};

await main();
