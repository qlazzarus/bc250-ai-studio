import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { type Asset, type AssetMetadata, type Job, type StudioModel, type SystemStatus, StudioApi, isLegacyComposition } from "./api";
import { PixelStudio } from "./PixelStudio";
import Settings from "./types/Settings";
import { API_KEY, ASSETS_PER_PAGE, JOBS_PER_PAGE } from "./constants";
import ImageViewer from "./components/ImageViewer";
import Pagination from "./components/Pagination";
import JobCard from "./components/JobCard";
import Metadata from "./components/MetadataModal";
import date from "./lib/date";
import editable from "./lib/editable";
import fixedValue from "./lib/fixedValue";
import optionStatus from "./lib/optionStatus";
import PromptBuilder from "./components/PromptBuilder";
import ComposePanel from "./components/ComposePanel";
import { composeStripView, type ComposeStatusView } from "./prompt/composeView";
import { initialBuilderState, appliedForFamily, restartBuilder, restoreComposition, v1OnlyWhenUnsupported, withReboundFamily } from "./prompt/builderState";
import { changeSceneFamily } from "./prompt/scene";
import { DICTIONARY, DICTIONARY_VERSION } from "./prompt/dictionary";
import { readProposalCapability, UNSUPPORTED, type ProposalCapability } from "./prompt/proposalCapability";
import { readComposeCapability, COMPOSE_UNSUPPORTED, type ComposeCapability } from "./prompt/composeCapability";
import { type AppliedResult, type ComposeTarget } from "./prompt/composeSession";
import type { EditSelection, StructuredScene } from "./prompt/structuredScene";
import { toSnapshot, fromSnapshot, restoreGaps, COMPOSE_COMPILER_VERSION } from "./prompt/composeSnapshot";
import { characterCount, validateSubmission, type ValidationIssue } from "./prompt/validation";
import { queueCounts, queueExpanded, queueSummary } from "./lib/queue";
import { queueNavMessage, receiptText, type QueueNavPhase } from "./lib/jobsView";
import { detailSummary, FIELD_IN_DETAILS, FIELD_LABEL, FIELD_SELECTOR, firstIssue, seedIssue } from "./lib/generate";
import { resolveReturn, type ReturnTarget } from "./lib/dialog";
import { artPath, parseArtRoute, ART_HOME, galleryFallback, type ArtScreen } from "./lib/routes";

/**
 * UIX06A: one read's outcome, without a throw that would take its siblings down with it.
 *
 * The four startup reads are independent, so they are settled independently. `Promise.all`
 * would reject on the first failure and discard the other three replies.
 */
type Settled<T> = { ok: true; value: T } | { ok: false; reason: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (reason) {
    return { ok: false, reason };
  }
}

/** The sentence a failed read reports, in the shape `.errorbox` has always shown. */
function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "API 연결에 실패했습니다.";
}

/**
 * UIX06A: the visible screen switcher. Each entry is a real address, so it can be opened in a
 * new tab and the browser's own Back works. `screen` decides the `aria-current` marker.
 */
const NAV_ITEMS: { to: string; label: string; screen: ArtScreen }[] = [
  { to: artPath.overview(), label: "개요", screen: "overview" },
  { to: artPath.compose(), label: "장면 구성", screen: "compose" },
  { to: artPath.generate(), label: "생성 설정", screen: "generate" },
  { to: artPath.jobs(), label: "작업 큐", screen: "jobs" },
  { to: artPath.gallery(), label: "갤러리", screen: "gallery" },
];

/**
 * UIX06A: which panels a screen shows.
 *
 * `overview` is the screen this app always had — composer, queue and gallery on one page — and
 * every earlier task measured that page. The focused routes are the same panels with the others
 * out of the way, so a link to `/art/jobs` shows the queue and nothing else while `/art` stays
 * exactly what it was. A route must never be able to *hide work*: the panels are only ever
 * hidden, never unmounted, so nothing here can cancel a request or drop a session.
 */
function showsPanel(screen: ArtScreen, panel: "composer" | "jobs" | "gallery"): boolean {
  if (screen === "overview") return true;
  if (panel === "composer") return screen === "compose" || screen === "generate";
  return screen === panel;
}

const initialSettings: Settings = {
  modelId: "", prompt: "", negativePrompt: "", preset: "balanced", resolution: "512x512",
  steps: 4, cfgScale: 1, samplingMethod: null, scheduler: null, seed: "-1", batchCount: 1,
};

/**
 * UCP05: three Korean examples for the integrated field.
 *
 * They exist so the first action is not typing into an empty box, and each one exercises a
 * different path of the composer: one subject with an attribute, two entities with a
 * relation, and a scene that needs more than a subject sentence. They are dictionary
 * phrases, so the rules-only path can also read them.
 */
const COMPOSE_EXAMPLES = [
  "비 오는 골목에 서 있는 여성",
  "두 사람이 카페 창가에 앉아 있다",
  "네온 조명 아래 전신 사진",
];

function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [models, setModels] = useState<StudioModel[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  /**
   * UIX06A: the URL is the screen selector. There is no `view`/`studio` state beside it.
   *
   * `route` is read from the address bar on every render, so a pasted link, a reload, Back and
   * Forward all land on the same screen by construction. The only thing this component writes
   * is an explicit move by the user (`navigate`), which is also what creates a history entry.
   *
   * Nothing here is a React `key`: the editor tree below is not remounted by a route change,
   * so the compose session, the request in flight and the receipt all survive navigation.
   */
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(
    () => parseArtRoute(location.pathname, location.search),
    [location.pathname, location.search],
  );
  /**
   * UIX06A: the page numbers come from the URL, not from their own state.
   *
   * A `?page=2` link has to open page 2 on a cold load, and Back has to return to the page the
   * user left — neither is possible if a separate `useState(0)` is the authority. The setters
   * below write the URL, and the value is read back from the same `route` the screen uses, so
   * there is exactly one answer.
   */
  const jobPage = route.page;
  const assetPage = route.page;
  /**
   * UX03: `null` means the user has not chosen yet, so the polled list decides the
   * default. Once they click, the choice is kept and polling never resets it.
   */
  const [jobsExpanded, setJobsExpanded] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  /** UIX06A: a shareable filter, so it is read from `?archived=1` rather than held in state. */
  const showArchived = route.archived;
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [missingAssetIds, setMissingAssetIds] = useState<Record<string, true>>({});
  const assetUrlsRef = useRef<Record<string, string>>({});
  const [metadata, setMetadata] = useState<AssetMetadata | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  /**
   * UIX06A: the image id whose single-resource lookup *succeeded*.
   *
   * The dialog's visibility comes from the URL, but a URL alone is not proof the image exists:
   * this gate means "we asked the server and it answered", so a mistyped `/art/gallery/nope`
   * shows the not-found notice instead of an empty viewer.
   */
  const [viewedId, setViewedId] = useState<string | null>(null);
  /**
   * UIX06A: a permalink's single-resource lookup failed.
   *
   * Kept apart from `error` because it is about the address the user opened, and it belongs
   * next to the list it refers to — with a way back — rather than in the global banner.
   */
  const [imageLookupFailure, setImageLookupFailure] = useState<string | null>(null);
  const [jobLookupFailure, setJobLookupFailure] = useState<string | null>(null);
  /**
   * UIX06: the element that opened the dialog, and where focus must go when it closes. A ref
   * rather than state because it is read once, at close time, and writing it must not render.
   * `returnTo` names the *cause* of closing (opener / final prompt / gallery heading) rather
   * than an element, so the decision survives the card being removed by a refresh.
   */
  const openerRef = useRef<HTMLElement | null>(null);
  const returnToRef = useRef<ReturnTarget | null>(null);
  const galleryHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataFailure, setMetadataFailure] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [builder, setBuilder] = useState(initialBuilderState);
  const [compositionSupported, setCompositionSupported] = useState(false);
  /**
   * TRANS01 §2.2: `remainder` may only be sent to a server that advertises v2.
   * "Supported" (v1) and "v2 aware" are separate facts: an old server accepts a
   * composition but rejects the new key with `extra_forbidden`, so the write path has
   * to ask this, not `compositionSupported`.
   */
  const [remainderSupported, setRemainderSupported] = useState(false);
  /**
   * UCP07: `schema_versions` includes 3, i.e. the server stores scene + chips + the apply
   * record. Separate from `compositionSupported` for the same reason v2 is: sending a v3
   * body to a server that advertises `[1, 2]` is a `422` (`extra_forbidden`), so the write
   * path must ask about the version it is actually writing.
   */
  const [compositionV3Supported, setCompositionV3Supported] = useState(false);
  const [maxBodyBytes, setMaxBodyBytes] = useState<number | null>(null);
  /**
   * LLM-I04: default is "absent", so the AI action stays hidden until the server
   * proves it can serve a proposal. A failed capabilities call is not an error to
   * report: the rule-based suggestions keep working.
   */
  const [proposalCapability, setProposalCapability] = useState<ProposalCapability>(UNSUPPORTED);
  /**
   * UCP05: the raw `prompt_compose` block, kept instead of a derived answer because the
   * profile version is per family and the family changes with the model selector. Storing
   * the raw block lets `readComposeCapability` be re-run for the new family on every model
   * change, without a second capabilities request.
   */
  const [composeBlock, setComposeBlock] = useState<Parameters<typeof readComposeCapability>[0]>(undefined);
  /** The exact string the compose panel last wrote, for overwrite protection. */
  const [composedApplied, setComposedApplied] = useState<string | null>(null);
  /**
   * UCP07: what the compose panel last *recorded* as applied, plus the scene it ran
   * against. This is the only ingredient of a v3 snapshot that does not already live here;
   * it is deliberately not derived from `composedApplied`, which is a string used for
   * overwrite protection and knows nothing about chips or a scene.
   */
  const [composeRecord, setComposeRecord] = useState<{
    applied: AppliedResult | null;
    scene: StructuredScene;
    briefKo: string;
    selections: EditSelection[];
  } | null>(null);
  /**
   * What a restored v3 record could not supply, or `null` when it supplied everything.
   *
   * A separate state from `error` because this is not a failure: the restore succeeded and
   * the image's prompts are back on screen. The sentences exist so a blank scene or a
   * missing apply history reads as "the record never had it" rather than "the restore
   * broke".
   */
  const [composeRestoreNotice, setComposeRestoreNotice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /**
   * UIX04: a synchronous twin of `submitting`, for the double-submit guard.
   *
   * `submitting` is React state, so it is still `false` inside the *same* event-loop turn that
   * sets it: three programmatic clicks dispatched together all read the pre-update value and all
   * create a job. The disabled attribute does not help either — it lands with the next commit,
   * after the third click has already run. A ref updates immediately, which is what makes the
   * guard hold for clicks that arrive before React has re-rendered.
   */
  const submittingRef = useRef(false);
  /**
   * UIX05: the receipt for the last accepted job — the server's own `job_id`, and the status
   * it was accepted in.
   *
   * Deliberately *not* part of `jobs`: the queue list is a polled snapshot that a failed read
   * leaves untouched and a slow read replaces wholesale. The receipt is a fact about the POST
   * and lives in its own state, so a `GET /jobs` failure can neither erase it nor turn it into
   * a generation failure — and nothing here triggers a retry of the POST.
   */
  const [receipt, setReceipt] = useState<{ jobId: string; status: string } | null>(null);
  /**
   * UIX05: which job the user asked to see, and how locating it went.
   *
   * `loading` is set by the click and cleared by the read that answers it, so the queue can say
   * "찾는 중" before the list has any chance to contain the job. `missing` is a real answer — the
   * job is not in this page of the list — and is kept apart from `error` because the fixes differ.
   */
  const [queueNav, setQueueNav] = useState<{ jobId: string; phase: QueueNavPhase } | null>(null);
  /**
   * UIX06A: did the dialog open from inside this session?
   *
   * A dialog opened by clicking a card can be closed by popping the history entry that opening
   * it pushed. One opened from a pasted link has no such entry — popping would leave the app
   * entirely — so closing it replaces the location with the gallery instead. This flag is the
   * difference between those two cases, and it is the *only* thing that decides between
   * `navigate(-1)` and `navigate(path, { replace: true })`.
   */
  const openedFromListRef = useRef(false);
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptBlurred, setPromptBlurred] = useState(false);
  /**
   * UIX01: the Korean path folds but never unmounts.
   *
   * `hidden` rather than a conditional render keeps the composer's session — brief, chips,
   * candidates, request id — alive while the user looks at the English field. Folding
   * therefore cannot drop work, cannot remount the editor and cannot send a request.
   * The default is open, so the first screen is the one the earlier tasks measured.
   */
  const [composePathOpen, setComposePathOpen] = useState(true);
  const composeRegionRef = useRef<HTMLDivElement | null>(null);
  const finalPromptRef = useRef<HTMLTextAreaElement | null>(null);
  /** Focus is applied after the commit that reveals the target; see the two effects below. */
  const [composeFocusTick, setComposeFocusTick] = useState(0);
  const [finalFocusTick, setFinalFocusTick] = useState(0);
  /**
   * UIX01/UIX03: the compose session as the panel reports it, for the read-only strip.
   *
   * The panel owns the session; this is only what it announced, so the strip describes the
   * phase the panel is actually in. Nothing here is written back or used to fetch — the
   * strip is a projection, and a fold must not restart the request it reports on.
   */
  const [composeStatus, setComposeStatus] = useState<ComposeStatusView | null>(null);
  /**
   * UIX04: whether 세부 생성 설정 (Steps/CFG/Seed and the sampler notes) is unfolded.
   *
   * UI-only, and deliberately not part of `settings`: folding must not be able to change what
   * is sent. The region is folded with `hidden`, never unmounted, so a preset's values and any
   * manual edit survive any number of folds — the inputs keep their DOM nodes and `settings`
   * keeps owning the values either way.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The field a blocked submit wants to move to, applied after the commit that unfolds it.
   *
   * A ref rather than state because it is read exactly once by the effect below and must not
   * cause a render of its own; the tick only exists to schedule that read after the commit.
   */
  const pendingFieldRef = useRef<string | null>(null);
  const [settingsFocusTick, setSettingsFocusTick] = useState(0);

  const api = useMemo(() => new StudioApi("/api/v1", API_KEY), []);
  const activeModel = models.find((model) => model.model_id === settings.modelId);
  /** UX03: counts are derived from the polled list, so the header text never goes stale. */
  const queue = useMemo(() => queueCounts(jobs), [jobs]);
  const queueLine = useMemo(() => queueSummary(jobs), [jobs]);
  const queueOpen = queueExpanded(jobsExpanded, jobs);
  const generationOptions = activeModel?.generation_options;
  const cfgOption = generationOptions?.cfg_scale;
  const negativeOption = generationOptions?.negative_prompt;
  const samplingOption = generationOptions?.sampling_method;
  const schedulerOption = generationOptions?.scheduler;
  const cfgEditable = editable(cfgOption) || (!cfgOption && Boolean(activeModel?.supported_parameters.includes("cfg_scale")));
  const requiredCfg = negativeOption?.requires.cfg_scale;
  const negativeEnabled = Boolean(
    negativeOption
      ? negativeOption.mode !== "unsupported" && (!requiredCfg || requiredCfg.includes(settings.cfgScale))
      : activeModel?.supported_parameters.includes("negative_prompt"),
  );
  const reportError = useCallback((message: string) => setError(message), []);

  /**
   * UCP05: the compose target, or `null` when there is nothing to compose for.
   *
   * `null` is passed to the panel as an unsupported capability rather than a dummy target:
   * a target with an empty model ID would be a *valid object* that fails deep inside
   * `buildComposeBody`, moving the refusal from "no model chosen" to "request could not be
   * built", which reads to the user as a bug rather than a missing step.
   */
  const composeTarget: ComposeTarget | null = activeModel ? {
    modelId: activeModel.model_id,
    family: activeModel.family,
    // The profile version comes from the capability, which is per family. Before the
    // capabilities call resolves there is none, so `0` means "not yet known" and the
    // capability gate refuses the request instead of guessing.
    profileVersion: readComposeCapability(composeBlock, DICTIONARY_VERSION, activeModel.family).profileVersion ?? 0,
    dictionaryVersion: DICTIONARY_VERSION,
  } : null;
  const composeCapability: ComposeCapability = composeTarget
    ? readComposeCapability(composeBlock, DICTIONARY_VERSION, composeTarget.family)
    : COMPOSE_UNSUPPORTED;

  /**
   * The one write path from the compose panel into the image request.
   *
   * Both text fields are written in a single `setSettings`, because two sequential updates
   * would let the panel's `appliedPrompt` prop observe a state where the positive had
   * changed and the negative had not — which is exactly the mismatch the overwrite check
   * is meant to detect.
   */
  const applyComposedPrompt = useCallback((input: { positive: string; negative: string | null }) => {
    setPromptDirty(true);
    // Remember exactly what was written, so the panel can tell "the user typed over this"
    // from "this is still the candidate I applied" and only confirm in the first case.
    setComposedApplied(input.positive);
    setSettings((old) => ({ ...old, prompt: input.positive,
      negativePrompt: input.negative !== null ? input.negative : old.negativePrompt }));
  }, []);

  /**
   * UCP06: undo of one apply, as a *write* the panel cannot perform itself.
   *
   * The panel owns the compose session (and knows which applied record to go back to), but
   * the final prompt fields live here. `appliedPrompt` is passed back with the text because
   * it decides overwrite protection: restoring a previously applied candidate means the
   * field is panel-written again, while restoring the user's own typing means it is not.
   * `promptDirty` is left alone — the user's work is being put back, not discarded.
   */
  const restoreComposedPrompt = useCallback((input: {
    positive: string; negative: string; appliedPrompt: string | null;
  }) => {
    setComposedApplied(input.appliedPrompt);
    setSettings((old) => ({ ...old, prompt: input.positive, negativePrompt: input.negative }));
  }, []);

  /**
   * UIX05: the ordering guard for the job list.
   *
   * Two readers write `jobs` — the 4s poll and every explicit refresh (the header button, a
   * card's cancel/retry, the queue navigation) — and they can overlap. Without a guard the
   * *older* response wins whenever it happens to resolve last, which puts a stale page or a
   * stale job status back on screen after the user has already seen the newer one.
   *
   * `token` is incremented when a read is issued and compared when it lands, so only the newest
   * read may write. That covers page changes too, without a second condition: `refresh` is
   * rebuilt when `jobPage` changes and the poll effect re-runs on it, so a new read always takes
   * a newer token before the old one can land — and the old one is then discarded.
   */
  const jobsTokenRef = useRef(0);
  /** The job the queue is being asked to find; cleared by the read that answers it. */
  const navTargetRef = useRef<string | null>(null);
  /**
   * The only writer of `jobs`.
   *
   * It resolves a pending navigation too: the read that answers "where is my job" is the same
   * read that fills the list, so asking twice would be a second request for the same answer.
   * `found` and `missing` are decided here, against the page actually on screen — never against
   * a different job, and never by silently selecting a neighbour.
   */
  const applyJobs = useCallback((next: Job[], token: number) => {
    if (token !== jobsTokenRef.current) return;
    setJobs(next);
    const target = navTargetRef.current;
    if (!target) return;
    navTargetRef.current = null;
    setQueueNav({ jobId: target, phase: next.some((job) => job.job_id === target) ? "found" : "missing" });
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!api) return;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) return;
    signal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10000);
    // Issued after the abort wiring, so an aborted call still consumes a token and cannot
    // later be mistaken for the newest read.
    jobsTokenRef.current += 1;
    const token = jobsTokenRef.current;
    /**
     * UIX06A: each read settles on its own.
     *
     * `Promise.all` rejected the whole batch when *any* one of the four failed, so a failing
     * `/jobs` (or `/assets`) threw away perfectly good `status` and `models` replies: the
     * generate form stayed disabled with no model until the next poll happened to succeed, and
     * a permalink into the gallery could not initialise anything else either. The four reads
     * share no data, so one failure is one resource's failure — the other three still apply.
     *
     * This is not a move to `allSettled` for its own sake: the ordering guard, the single
     * `applyJobs` writer and the poll interval are unchanged. Only the *coupling* is removed.
     */
    const [statusRead, modelsRead, jobsRead, assetsRead] = await Promise.all([
      settle(api.status(controller.signal)),
      settle(api.models(controller.signal)),
      settle(api.jobs(JOBS_PER_PAGE, jobPage * JOBS_PER_PAGE, controller.signal)),
      settle(api.assets(showArchived, ASSETS_PER_PAGE, assetPage * ASSETS_PER_PAGE, controller.signal)),
    ]);
    if (controller.signal.aborted) return;

    // A resource that answered is applied even when a sibling failed. A resource that failed
    // leaves its previous value alone: blanking `models` on one bad poll would take the
    // selected model and the whole generate form with it.
    if (statusRead.ok) setStatus(statusRead.value);
    if (modelsRead.ok) {
      setModels(modelsRead.value);
      const first = modelsRead.value.find((model) => model.execution_enabled);
      setSettings((old) => old.modelId ? old : { ...old, modelId: first?.model_id || "" });
    }
    if (assetsRead.ok) setAssets(assetsRead.value);
    if (jobsRead.ok) applyJobs(jobsRead.value, token);

    /**
     * One sentence for whatever failed, and the first failure in a fixed order so a repeated
     * poll reports the same thing rather than alternating. `status` leads because it is the
     * health line the user reads first.
     */
    const failure = [statusRead, modelsRead, jobsRead, assetsRead]
      .find((read): read is { ok: false; reason: unknown } => !read.ok);
    if (failure) {
      if (!signal?.aborted) {
        setError(timedOut ? "API 응답 시간이 초과되었습니다. 다시 시도합니다." : reasonText(failure.reason));
      }
      /**
       * UIX05: a read that fails while the queue was asked to find a job is the queue's answer
       * too. Resolved here rather than at the call site because `refresh` swallows the error —
       * its callers (the poll, a card's cancel/retry) must not treat a list failure as their own
       * — so this is the only place that knows the read did not produce a list.
       */
      if (!jobsRead.ok) {
        const target = navTargetRef.current;
        if (target) {
          navTargetRef.current = null;
          setQueueNav({ jobId: target, phase: "error" });
        }
      }
    }
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    controller.abort();
  }, [api, assetPage, jobPage, showArchived, applyJobs]);

  useEffect(() => { 
    if (!api) return;

    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();

    async function poll() {
      try {
        await refresh(controller.signal);
      } finally {
        if (!stopped) {
          timer = window.setTimeout(() => void poll(), 4000);
        }
      }
    }

    void poll();

    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    }
  }, [api, refresh]);
  
  // Object URLs must survive list refreshes. The old effect revoked every URL
  // whenever a new thumbnail arrived, which made gallery images intermittently
  // disappear or fail to open.
  useEffect(() => { assetUrlsRef.current = assetUrls; }, [assetUrls]);
  useEffect(() => () => Object.values(assetUrlsRef.current).forEach(URL.revokeObjectURL), []);

  useEffect(() => {
    if (!api) return;
    const missing = assets.filter((asset) => !assetUrls[asset.asset_id] && !missingAssetIds[asset.asset_id]);
    if (!missing.length) return;
    let active = true;
    void Promise.allSettled(missing.map(async (asset) => [asset.asset_id, await api.image(asset.asset_id)] as const)).then((results) => {
      if (!active) return;
      const loaded = results.filter((result): result is PromiseFulfilledResult<readonly [string, string]> => result.status === "fulfilled").map((result) => result.value);
      const unavailable = results.flatMap((result, index) => result.status === "rejected" ? [missing[index].asset_id] : []);
      if (loaded.length) setAssetUrls((old) => ({ ...old, ...Object.fromEntries(loaded) }));
      if (unavailable.length) setMissingAssetIds((old) => ({ ...old, ...Object.fromEntries(unavailable.map((id) => [id, true])) }));
    });
    return () => { active = false; };
  }, [api, assets, assetUrls, missingAssetIds]);

  useEffect(() => {
    if (!settings.prompt && !builder.scene.selections.length && !builder.scene.freeTextKo) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [settings.prompt, builder.scene]);

  useEffect(() => {
    const controller = new AbortController();
    api.capabilities(controller.signal).then((data) => {
      setCompositionSupported(Boolean(data.prompt_composition?.schema_versions?.includes(1)));
      setRemainderSupported(Boolean(data.prompt_composition?.schema_versions?.includes(2)));
      setCompositionV3Supported(Boolean(data.prompt_composition?.schema_versions?.includes(3)));
      setProposalCapability(readProposalCapability(data.prompt_proposals, DICTIONARY_VERSION));
      setComposeBlock(data.prompt_compose);
      const limit = data.request_limits?.max_body_bytes;
      setMaxBodyBytes(typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0 ? limit : null);
    }).catch(() => {
      setCompositionSupported(false); setRemainderSupported(false); setCompositionV3Supported(false); setMaxBodyBytes(null); setProposalCapability(UNSUPPORTED);
      setComposeBlock(undefined);
    });
    return () => controller.abort();
  }, [api]);

  /**
   * UIX01: switching the visible input path.
   *
   * Nothing is written and nothing is fetched: the Korean region only gains or loses the
   * `hidden` attribute, so its mounted state (brief, chips, candidates, in-flight request)
   * is untouched, and the English field is always mounted. Focus is moved through a tick
   * and an effect, because a control inside a just-unfolded region cannot take focus in the
   * same commit that reveals it.
   */
  function openPath(path: "compose" | "final") {
    if (path === "compose") {
      // Re-clicking the active path must not steal focus from whatever the user is editing.
      if (composePathOpen) return;
      setComposePathOpen(true);
      setComposeFocusTick((tick) => tick + 1);
      return;
    }
    // The Korean region folds on the direct path so the field it links to is what the user
    // lands on, rather than a long form they have to scroll past.
    setComposePathOpen(false);
    setFinalFocusTick((tick) => tick + 1);
  }

  useEffect(() => {
    if (!composeFocusTick) return;
    const node = composeRegionRef.current?.querySelector<HTMLTextAreaElement>("#compose-brief");
    node?.focus();
  }, [composeFocusTick]);

  useEffect(() => {
    if (!finalFocusTick) return;
    /**
     * UIX06A: the prompt lives in the composer panel, and a route change is what reveals it.
     * React Router applies its location update inside a transition, so it can commit *after* the
     * tick that asked for focus — focusing a field inside a still-hidden panel does nothing, and
     * the user was left on `<body>` (seen at both 360 and 1280 after a reuse). Keying the effect
     * on the screen as well means the focus happens whichever of the two commits second.
     */
    if (!showsPanel(route.screen, "composer")) return;
    finalPromptRef.current?.focus();
  }, [finalFocusTick, route.screen]);

  function changeBuilderFamily(family: string): boolean {
    if (!builder.scene.targetFamily || builder.scene.targetFamily === family) return true;
    if (builder.scene.selections.length && !window.confirm("모델 계열을 변경하면 사전 항목을 새 계열의 표현으로 다시 연결합니다. 기존 최종 프롬프트는 유지됩니다. 계속할까요?")) return false;
    // TRANS06: the scene is rebound and the draft dropped, but `applied` is kept. It is
    // the record of what was accepted — including the translations and their provenance —
    // and `appliedForFamily` still refuses to submit it for the new family. Dropping it
    // used to erase the inclusion panel and re-record the next apply without `remainder`.
    setBuilder((old) => withReboundFamily(old, changeSceneFamily(old.scene, family, DICTIONARY, DICTIONARY_VERSION)));
    return true;
  }

  function chooseModel(modelId: string) {
    const model = models.find((item) => item.model_id === modelId);
    if (!model || !model.execution_enabled || !changeBuilderFamily(model.family)) return;
    /*
     * UCP08: the compose apply record dies with the model it was made for.
     *
     * `composeRecord` is the only ingredient that turns a submission into a v3 snapshot, and
     * `toSnapshot` guards the *family* but not the model: a `klein-4b-q4` → `klein-4b-q8`
     * switch is the same family, so the record survived and the next submit wrote
     * `target_model_id: klein-4b-q8` with `applied` from the Q4 run. That prompt was never
     * generated for Q8, and the panel has already expired those candidates for the same
     * reason. Clearing it makes the submission fall back to the earlier record this file
     * still holds instead of claiming an apply the new model never ran. The prompt text is
     * untouched — it is the user's work, not the panel's.
     */
    setComposeRecord(null);
    const preset = model.presets.balanced || Object.values(model.presets)[0];
    setSettings((old) => ({ ...old, modelId, prompt: old.prompt, negativePrompt: old.negativePrompt,
      preset: model.presets.balanced ? "balanced" : Object.keys(model.presets)[0],
      resolution: `${preset.width}x${preset.height}`, steps: preset.steps,
      cfgScale: Number(model.generation_options?.cfg_scale.default ?? preset.cfg_scale),
      samplingMethod: model.generation_options?.sampling_method.default === null
        ? null : String(model.generation_options?.sampling_method.default),
      scheduler: model.generation_options?.scheduler.default === null
        ? null : String(model.generation_options?.scheduler.default),
    }));
  }

  function choosePreset(presetName: string) {
    if (!activeModel) return;
    const preset = activeModel.presets[presetName];
    setSettings((old) => ({ ...old, preset: presetName, resolution: `${preset.width}x${preset.height}`,
      steps: preset.steps, cfgScale: preset.cfg_scale,
      negativePrompt: 
        !requiredCfg || requiredCfg?.includes(preset.cfg_scale) 
        ? old.negativePrompt 
        : "" 
      }));
  }

  function buildRequest(): Record<string, unknown> {
    const [width, height] = settings.resolution.split("x").map(Number);
    const body: Record<string, unknown> = {
      job_type: settings.batchCount > 1 ? "image.batch" : "image.generate", source: "nsfw",
      model_id: activeModel?.model_id, prompt: settings.prompt,
      width, height, steps: settings.steps, seed: Number(settings.seed),
      batch_count: settings.batchCount, preset: settings.preset,
    };
    const applied = appliedForFamily(builder, activeModel?.family ?? "", compositionSupported);
    // UCP07: v3 records the scene, the chips' sources and the apply record, so it is
    // preferred when the server advertises it *and* the compose panel has an apply to
    // record. `toSnapshot` returns null without one, and the v1/v2 path below is the
    // fallback rather than a v3 body describing an apply that never happened.
    const snapshot = compositionV3Supported && composeRecord && activeModel && composeTarget
      ? toSnapshot({
          edit: { ...composeRecord, choices: [], targetModelId: activeModel.model_id,
            targetFamily: activeModel.family, profileVersion: composeTarget.profileVersion,
            dictionaryVersion: DICTIONARY_VERSION },
          scene: composeRecord.scene,
          applied: composeRecord.applied,
          target: composeTarget,
          compilerVersion: COMPOSE_COMPILER_VERSION,
        })
      : null;
    if (snapshot) body.prompt_composition = snapshot;
    else if (applied && compositionSupported) body.prompt_composition = v1OnlyWhenUnsupported(applied, remainderSupported);
    if (cfgEditable) body.cfg_scale = settings.cfgScale;
    if (negativeEnabled && settings.negativePrompt) body.negative_prompt = settings.negativePrompt;
    if (editable(samplingOption) && settings.samplingMethod) body.sampling_method = settings.samplingMethod;
    if (editable(schedulerOption) && settings.scheduler) body.scheduler = settings.scheduler;
    return body;
  }
  const submissionIssues = validateSubmission(buildRequest(), activeModel?.family ?? "", maxBodyBytes);
  /**
   * UIX04: the seed is checked once, by `seedIssue`, and folded into the same list.
   *
   * `validateSubmission` has never covered the seed — it validates the composition record and the
   * body size — so the seed check has to be added rather than duplicated. Appending it keeps one
   * list for the button, the field marks and the blocker line.
   */
  const seedProblem = seedIssue(settings.seed);
  /**
   * One list decides "blocked": the button, the field marks and the inline line all read it.
   *
   * The seed is appended rather than re-validated here, so a model whose CFG box is disabled or a
   * Steps value the server rejects cannot be described two different ways.
   */
  const allIssues: ValidationIssue[] = seedProblem ? [...submissionIssues, seedProblem] : submissionIssues;
  /** True when the given field carries a blocking issue; used for `aria-invalid` only. */
  const hasIssue = (field: string) => allIssues.some((issue) => issue.field === field);
  /**
   * TRANS05: the accepted translations go to a v2 server only. When the snapshot on
   * screen is v2 but the server advertises v1, the body is sent as v1 and the
   * translations are dropped — say so, because the difference is invisible otherwise
   * and the record would not match what the user built.
   */
  const remainderDowngraded = !remainderSupported
    && appliedForFamily(builder, activeModel?.family ?? "", compositionSupported)?.schema_version === 2;
  const promptIssues = submissionIssues.filter((issue) => issue.field === "prompt");
  const negativeIssues = submissionIssues.filter((issue) => issue.field === "negative_prompt");
  const otherIssues = submissionIssues.filter((issue) => !["prompt", "negative_prompt"].includes(issue.field));
  // An untouched empty prompt is a starting hint, not an error the user caused.
  // Once the field is edited, blurred, or holds restored text, show the real state.
  const promptTouched = promptDirty || promptBlurred;
  const showPromptIssues = settings.prompt.length > 0 || promptTouched;
  const promptHint = !promptTouched && settings.prompt.length === 0
    ? "생성할 장면을 적거나, 위의 ‘한글 장면으로 만들기’로 초안을 만들어 적용하세요." : "";

  /**
   * UIX01/UIX03: the one line the folded strip shows.
   *
   * The derivation lives in `composeStripView` so the precedence rules (staleness outranks
   * the phase) are testable directly. This call site only decides *where* to render it.
   */
  const composeStrip = composeStripView(composeStatus);

  /**
   * UIX05: the queue's locating sentence, or `null` when there is nothing to say.
   *
   * Derived from `queueNav` on every render, so a phase change cannot leave a stale sentence
   * behind, and the wording lives in `jobsView.ts` where it can be tested without a browser.
   */
  const navMessage = queueNavMessage(queueNav?.phase ?? "found");

  /**
   * UIX05: switching page through the header pagination.
   *
   * A pending navigation is dropped: the user has chosen a different page, so a message about a
   * job on the page they just left would describe something they can no longer see.
   */
  function changeJobPage(page: number) {
    if (navTargetRef.current) { navTargetRef.current = null; setQueueNav(null); }
    // UIX06A: the page is in the URL, so moving pages is a navigation — `?page=N` is shareable
    // and Back returns here. `replace` is wrong: the user asked to go somewhere.
    navigate(artPath.jobs(page));
  }

  /**
   * UIX04: the first blocking reason in reading order, or `null` when nothing blocks.
   *
   * `firstIssue` sorts by where the field sits on screen rather than by the order the validators
   * produced their entries, so the line always points at the topmost thing to fix. Nothing here
   * decides *whether* the submission is blocked: `allIssues.length` does, and the button reads
   * the same list.
   */
  const blocker = firstIssue(allIssues);
  /**
   * An untouched empty prompt is a hint, not a failure, so its blocking line is withheld until
   * the user has actually engaged with the field — the same rule `showPromptIssues` applies to the
   * field's own message, and the same reason `promptHint` exists above. The button stays disabled
   * either way; this only decides whether the first visit is greeted with an error.
   */
  const blockerVisible = blocker !== null
    && !(blocker.field === "prompt" && !promptTouched && settings.prompt.length === 0);

  const detail = detailSummary({
    steps: settings.steps, cfgScale: settings.cfgScale, seed: settings.seed,
    sampling: settings.samplingMethod, scheduler: settings.scheduler,
    cfgEditable, samplingEditable: editable(samplingOption),
    schedulerEditable: editable(schedulerOption),
  });

  /**
   * UIX04: move to the field a blocked submit names.
   *
   * The fold is opened *first* and the focus is applied from an effect, because a control inside a
   * subtree that is still `hidden` cannot take focus — `focus()` on it is a silent no-op, so the
   * user would be told "move here" with nothing moving. `settingsFocusTick` schedules the read
   * after the commit that removes `hidden`; the ref carries *which* field across that commit
   * without a second render.
   */
  function moveToField(field: string) {
    const target = FIELD_SELECTOR[field];
    if (!target) return;
    if (FIELD_IN_DETAILS.includes(field) && !settingsOpen) setSettingsOpen(true);
    pendingFieldRef.current = field;
    setSettingsFocusTick((tick) => tick + 1);
  }

  useEffect(() => {
    if (!settingsFocusTick) return;
    const field = pendingFieldRef.current;
    pendingFieldRef.current = null;
    if (!field) return;
    const selector = FIELD_SELECTOR[field];
    const node = selector ? document.querySelector<HTMLElement>(selector) : null;
    // A disabled control (the CFG box on a fixed-CFG model, the negative field when the model
    // forbids it) cannot take focus either. Fall back to the region that explains the limit
    // instead of failing silently.
    if (node && !(node as HTMLInputElement).disabled) { node.focus(); return; }
    document.querySelector<HTMLElement>("#prompt-settings")?.scrollIntoView({ block: "nearest" });
  }, [settingsFocusTick]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!api || !activeModel) return;
    // Re-entry guard first: see `submittingRef`. A second submit in the same turn must not even
    // build a body, or it would queue a job the user did not ask for twice.
    if (submittingRef.current) return;
    const body = buildRequest();
    const issues = validateSubmission(body, activeModel.family, maxBodyBytes);
    const seed = seedIssue(settings.seed);
    const blocking = seed ? [...issues, seed] : issues;
    if (blocking.length) {
      // Same list the button is disabled by, so this branch is only reachable by a submit the
      // button could not have made (Enter in a field, or a race with a re-render). Report the
      // first issue in reading order and offer the move, exactly like the inline line does.
      const first = firstIssue(blocking) ?? blocking[0];
      setError(`${FIELD_LABEL[first.field] ?? first.field}: ${first.message}`);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true); setError("");
    try {
      const accepted = await api.createJob(body);
      /**
       * UIX05: the receipt comes from the POST's own reply, and only from there.
       *
       * It is set before any list read, so the confirmation is on screen even if `/jobs` is slow,
       * failing, or never asked. `jobPage` is reset to 0 for the same reason it always was: a
       * fresh job is the newest row, so it belongs on the first page. Nothing here navigates,
       * scrolls or focuses — that is the explicit button's job.
       */
      setReceipt({ jobId: accepted.job_id, status: accepted.status });
      setQueueNav(null);
      navTargetRef.current = null;
      // UIX06A: a fresh job is the newest row, so page 0 — expressed as the plain queue URL.
      // `replace` because the receipt is not a place the user asked to go.
      if (jobPage !== 0) navigate(artPath.jobs(0), { replace: true });
    } catch (reason) {
      // Server answers stay in `.errorbox`: they are not fixable by moving to a field, and
      // reporting them next to the button would suggest they are.
      setError(reason instanceof Error ? reason.message : "작업 접수 실패");
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  /**
   * UIX05: the explicit "작업 큐에서 보기" move.
   *
   * Four steps, in this order, and each one is the existing contract rather than a new one:
   *
   * 1. Unfold the queue (`setJobsExpanded`, the same flag the header button writes).
   * 2. Go to page 0 — the newest jobs' page, which is where a just-accepted job is.
   * 3. Read the list once, using `refresh()`. When the page *changed*, `setJobPage` re-runs the
   *    poll effect with the new page and that read is the one that answers; issuing a second
   *    read from here would race it and could resolve in either order.
   * 4. Mark the card on screen (`queueNav`/`spotlight`), which is a highlight, not a selection:
   *    nothing is written to the job and no other job is chosen if this one is absent.
   */
  async function showInQueue(jobId: string) {
    setJobsExpanded(true);
    setQueueNav({ jobId, phase: "loading" });
    navTargetRef.current = jobId;
    // UIX06A: the queue is asked for one job, and the address says so. A job on page 0 is the
    // common case; `artPath.job` carries no `?page=`, so arriving here from page 3 also resets
    // the page — the same move `setJobPage(0)` used to make, now visible in the URL.
    if (jobPage !== 0 || route.jobId !== jobId) navigate(artPath.job(jobId));
    if (jobPage === 0) {
      // Same page: `refresh` resolves the navigation in `applyJobs`, or reports `error` in its
      // catch. Neither path needs anything from this call site.
      await refresh();
      return;
    }
    // A page change re-runs the poll effect with the new page, and that read answers. Reading
    // here as well would be a second concurrent request whose answer could arrive first and be
    // thrown away by the ordering guard.
  }

  /**
   * UIX06A: opening a dialog is a navigation, because the dialog's identity is in the URL.
   *
   * `viewer` opens `/art/gallery/:id`; `metadata` opens `/art/gallery/:id/metadata`. Both push a
   * history entry and set `openedFromListRef`, which is what later lets closing *pop* back to
   * the list instead of replacing the location — the difference between a dialog opened here
   * and one opened from a pasted link, which has no entry of ours to pop.
   */
  function openViewer(asset: Asset, opener: HTMLElement | null) {
    openerRef.current = opener;
    openedFromListRef.current = true;
    returnToRef.current = { to: "opener" };
    navigate(artPath.image(asset.asset_id));
  }

  function openMetadata(asset: Asset, opener: HTMLElement | null) {
    openerRef.current = opener;
    openedFromListRef.current = true;
    returnToRef.current = { to: "opener" };
    setMetadataFailure(null);
    // The URL is the source of truth for *which* image and *which* dialog. The effect below
    // loads it, so opening does not duplicate that fetch here.
    navigate(artPath.imageMetadata(asset.asset_id));
  }

  /**
   * UIX06A: the address a closed dialog returns to.
   *
   * Popping is only correct when *this* session pushed the entry that opened the dialog. A
   * dialog reached by pasting a link, or by reloading on one, has no such entry: popping would
   * leave the app entirely. Those close by replacing the location with the gallery instead.
   */
  /** UIX06: focus the gallery heading after a card disappears from the list it was in. */
  function focusGalleryHeading() {
    window.requestAnimationFrame(() => galleryHeadingRef.current?.focus());
  }

  function closeDialogLocation() {
    if (openedFromListRef.current) {
      openedFromListRef.current = false;
      navigate(-1);
      return;
    }
    navigate(galleryFallback({ archived: showArchived }), { replace: true });
  }

  /** UIX06: one place that closes the detail dialog and puts focus where the cause says. */
  function closeMetadata() {
    const target = returnToRef.current;
    returnToRef.current = null;
    setMetadata(null);
    setSelectedAsset(null);
    setMetadataFailure(null);
    closeDialogLocation();
    if (!target) return;
    const node = resolveReturn(target, {
      opener: () => openerRef.current,
      finalPrompt: () => finalPromptRef.current,
      galleryHeading: () => galleryHeadingRef.current,
    });
    // After the commit, so the node being focused is the one that will still exist.
    window.requestAnimationFrame(() => node?.focus());
  }

  /**
   * UIX06A: leaving a dialog for a *different screen*.
   *
   * The restore rewrote the final prompt, so the user belongs on the generate screen looking at
   * it. `replace` is deliberate: the dialog the user opened is gone, and Back should return to
   * the gallery rather than to a dialog that no longer describes the current prompt.
   */
  function goToGenerate() {
    setMetadata(null);
    setSelectedAsset(null);
    setMetadataFailure(null);
    returnToRef.current = null;
    openedFromListRef.current = false;
    navigate(artPath.generate(), { replace: true });
    // The screen is now the generate one; focus follows after that commit.
    setFinalFocusTick((tick) => tick + 1);
  }

  function reuse(item: AssetMetadata) {
    // UIX06: a cancelled overwrite leaves the dialog open and focus where the choice was made.
    // `closeMetadata` is not called, so `returnToRef` is not consumed and the opener survives
    // for a later plain close.
    if (settings.prompt && settings.prompt !== item.prompt && !window.confirm("현재 최종 프롬프트를 선택한 결과의 프롬프트로 바꿉니다. 계속할까요?")) return;
    const model = models.find((entry) => entry.model_id === item.model_id);
    if (model && !changeBuilderFamily(model.family)) return;
    /*
     * UCP07: a v3 record is a *compose* record — scene, chip sources, apply history — and it
     * has no `SceneSpecification` shape, so it cannot go through `restoreComposition`. It is
     * read with `fromSnapshot`, whose whole job is to say what the record does and does not
     * prove:
     *
     * - the applied prompts come from `applied` when the record has one, and from nothing
     *   else otherwise. For a v1/v2 row the English is a *draft*, so it is restored as the
     *   prompt (as before) but never claimed as an apply;
     * - a record the module refuses (dangling entity, unknown version) restores nothing and
     *   says why, instead of half-restoring;
     * - `restoreGaps` names what a v1/v2 or trimmed record cannot supply, so an empty
     *   chip list on screen is explained rather than mistaken for "there were no chips".
     *
     * The compose panel is deliberately *not* repopulated from a restored record: it holds
     * its own session and its own candidates, and reviving candidates generated against an
     * older dictionary, profile or model would put a pressable button on screen whose prompt
     * the current dictionary can no longer justify. A restore is a starting point for a new
     * composition, not a resurrected reply.
     */
    if (!isLegacyComposition(item.prompt_composition) && item.prompt_composition) {
      const read = fromSnapshot(item.prompt_composition);
      if (!read.ok) {
        // UIX06: a record this client cannot interpret restores nothing. The dialog stays open
        // and says why, so the user can pick another image — closing it would look like the
        // restore had worked.
        setMetadataFailure(`이 기록을 복원하지 못했습니다 · ${read.message}`);
        return;
      }
      const gaps = restoreGaps(read.restored);
      setComposeRecord(null);
      setBuilder((old) => restartBuilder(old));
      setComposeRestoreNotice(gaps.length ? gaps.join(" ") : null);
      setSettings({ modelId: item.model_id,
        prompt: read.restored.applied?.positivePrompt ?? item.prompt,
        negativePrompt: read.restored.applied?.negativePrompt ?? item.negative_prompt,
        preset: item.preset, resolution: `${item.width}x${item.height}`, steps: item.steps,
        cfgScale: item.cfg_scale, samplingMethod: item.sampling_method ?? null,
        scheduler: item.scheduler ?? null, seed: String(item.seed), batchCount: 1 });
      // UIX06: a successful restore rewrites the final prompt, so that is where the user must
      // be — not back on the card they opened. UIX06A: that place is now `/art/generate`.
      goToGenerate();
      return;
    }
    // TRANS06: both branches start a new composition session (the inclusion list is keyed
    // by epoch), and both carry the epoch forward so it never repeats. A generation with a
    // recorded composition restores it — v2 supplies its own translations; v1 supplies
    // none and is never upgraded here. A generation without one is an explicit restart.
    // The read is from `builder`, whose epoch is the newest value even though the family
    // rebind above is still pending in the queue.
    setComposeRestoreNotice(null);
    // The guard above already returned for a v3 record, so this is the v1/v2 path. Written
    // as an explicit check rather than a comment so the type system enforces it.
    const legacy = item.prompt_composition;
    setBuilder((old) => isLegacyComposition(legacy)
      ? restoreComposition(legacy, old.compositionEpoch)
      : restartBuilder(old));
    setSettings({ modelId: item.model_id, prompt: item.prompt, negativePrompt: item.negative_prompt,
      preset: item.preset, resolution: `${item.width}x${item.height}`, steps: item.steps,
      cfgScale: item.cfg_scale, samplingMethod: item.sampling_method ?? null,
      scheduler: item.scheduler ?? null, seed: String(item.seed), batchCount: 1 });
    // UIX06A: same destination as the v3 branch — the restored prompt is on the generate screen.
    goToGenerate();
  }

  /** UIX06: closing the viewer returns to the card that opened it, or the heading if it is gone. */
  function closeViewer() {
    setViewedId(null);
    returnToRef.current = null;
    closeDialogLocation();
    const node = resolveReturn({ to: "opener" }, {
      opener: () => openerRef.current,
      finalPrompt: () => finalPromptRef.current,
      galleryHeading: () => galleryHeadingRef.current,
    });
    window.requestAnimationFrame(() => node?.focus());
  }

  async function changeArchive(restore: boolean) {
    if (!api || !selectedAsset || metadataBusy) return;
    setMetadataBusy(true);
    setMetadataFailure(null);
    try {
      if (restore) await api.restore(selectedAsset.asset_id);
      else await api.archive(selectedAsset.asset_id);
      // UIX06: archiving removes the card from this list, so returning to it would land on a
      // node that is about to be unmounted. The gallery heading is the stable place to resume.
      // UIX06A: the dialog's URL has to leave with it, or the address would still name a
      // dialog that is no longer open.
      returnToRef.current = { to: "gallery-heading" };
      openedFromListRef.current = false;
      setMetadata(null); setSelectedAsset(null); setMetadataFailure(null);
      navigate(artPath.gallery({ page: assetPage, archived: showArchived }), { replace: true });
      await refresh();
      focusGalleryHeading();
    } catch (reason) {
      // The dialog stays open: the action failed, and closing it would hide the reason behind
      // a message the user has to hunt for in the page-level error box.
      setMetadataFailure(`${restore ? "복원" : "보관"} 실패 · ${reason instanceof Error ? reason.message : "알 수 없는 오류"}`);
    } finally {
      setMetadataBusy(false);
    }
  }

  async function destroySelected() {
    if (!api || !selectedAsset || metadataBusy) return;
    if (!window.confirm("보관함에서 이 이미지와 메타데이터를 삭제합니다. 계속할까요?")) return;
    setMetadataBusy(true);
    setMetadataFailure(null);
    try {
      await api.destroy(selectedAsset.asset_id);
      returnToRef.current = { to: "gallery-heading" };
      openedFromListRef.current = false;
      setMetadata(null); setSelectedAsset(null); setMetadataFailure(null);
      navigate(artPath.gallery({ page: assetPage, archived: showArchived }), { replace: true });
      await refresh();
      focusGalleryHeading();
    } catch (reason) {
      setMetadataFailure(`삭제 실패 · ${reason instanceof Error ? reason.message : "알 수 없는 오류"}`);
    } finally {
      setMetadataBusy(false);
    }
  }

  const changeAssetPage = (page: number) => {
    Object.values(assetUrlsRef.current).forEach(URL.revokeObjectURL);
    setAssetUrls({}); setMissingAssetIds({});
    navigate(artPath.gallery({ page, archived: showArchived }));
  };
  const toggleArchived = () => {
    Object.values(assetUrlsRef.current).forEach(URL.revokeObjectURL);
    setAssetUrls({}); setMissingAssetIds({});
    // The filter is part of the address, so switching it is a navigation and page 0 is implied.
    navigate(artPath.gallery({ page: 0, archived: !showArchived }));
  };

  /**
   * UIX06A: `/` is the old address. It is *replaced*, so Back does not bounce between the two.
   */
  useEffect(() => {
    if (location.pathname === "/" ) navigate(ART_HOME, { replace: true });
  }, [location.pathname, navigate]);

  /**
   * UIX06A: a permalink names a resource the current page may not contain.
   *
   * `GET /jobs/{id}` and `GET /assets/{id}` already exist, so a link to job 47 resolves without
   * walking the list — no unbounded paging, and no new endpoint. The lookup is keyed on the id
   * in the URL, so Back/Forward between two permalinks loads the right one and a poll that
   * reorders the list cannot change which id is being shown.
   *
   * A failed lookup says so and offers the list; it never substitutes a neighbour.
   */
  useEffect(() => {
    const imageId = route.imageId;
    // Nothing to load. The dialog's visibility is derived from the URL, so leaving the route
    // needs no state reset here — and resetting it in an effect would be a cascading render.
    if (!imageId) return;
    // Already loaded (a click, or the same id re-rendered): nothing to fetch.
    if (selectedAsset?.asset_id === imageId) return;
    let cancelled = false;
    void (async () => {
      try {
        const asset = await api.asset(imageId);
        if (cancelled) return;
        setViewedId(asset.asset_id);
        if (route.metadata) {
          setSelectedAsset(asset);
          setMetadataFailure(null);
          setMetadata(await api.metadata(asset.asset_id));
        }
      } catch (reason) {
        if (cancelled) return;
        // Keep the URL: it is what the user asked for. The message says the lookup failed and
        // the gallery link is the way out.
        setViewedId(null); setMetadata(null); setSelectedAsset(null);
        setImageLookupFailure(`이미지를 찾을 수 없습니다 · ${reason instanceof Error ? reason.message : "알 수 없는 오류"}`);
      }
    })();
    return () => { cancelled = true; };
    // `route.metadata` is a dependency because the same image has two dialogs.
  }, [api, route.imageId, route.metadata, selectedAsset?.asset_id]);

  /**
   * UIX06A: `/art/jobs/:jobId` names one job.
   *
   * The list is still what renders the cards, so the job is also asked for directly: that is
   * what makes a permalink to a job on another page work, and it is the same single-resource
   * endpoint the queue already uses. It does not select a substitute when the id is unknown.
   */
  useEffect(() => {
    const jobId = route.jobId;
    if (!jobId) return;
    let cancelled = false;
    void (async () => {
      try {
        const job = await api.job(jobId);
        if (cancelled) return;
        setJobsExpanded(true);
        setQueueNav({ jobId: job.job_id, phase: "found" });
        setJobLookupFailure(null);
      } catch (reason) {
        if (cancelled) return;
        setQueueNav(null);
        setJobLookupFailure(`작업을 찾을 수 없습니다 · ${reason instanceof Error ? reason.message : "알 수 없는 오류"}`);
      }
    })();
    return () => { cancelled = true; };
  }, [api, route.jobId]);

  if (route.pixel) {
    return <><PixelStudio api={api} reportError={reportError} />{error && <div className="floating-error"><span>{error}</span><button onClick={() => setError("")}>닫기</button></div>}</>;
  }

  /**
   * UIX06A: a path this app does not serve.
   *
   * It says so instead of rendering a screen, because showing the studio under a URL that
   * describes nothing would leave the address bar disagreeing with the page.
   */
  if (!route.known) {
    return <main className="shell not-found">
      <header><div><p className="eyebrow">BC-250 · LOCAL AI</p><h1>Art Studio</h1></div></header>
      <section className="panel">
        <h2>페이지를 찾을 수 없습니다</h2>
        <p className="prompt-hint">{location.pathname} 주소는 이 앱이 제공하지 않습니다.</p>
        <p><Link className="quiet" to={ART_HOME}>Art Studio로 돌아가기</Link></p>
      </section>
    </main>;
  }

  return <main className="shell">
    <header><div><p className="eyebrow">BC-250 · LOCAL AI</p><h1>Art Studio</h1></div><div className="header-actions"><Link className="quiet" to={artPath.pixel()}>Pixel Studio</Link></div></header>
    <nav className="art-nav" aria-label="화면 이동">
      {NAV_ITEMS.map((item) => <Link key={item.to} className="quiet" to={item.to}
        aria-current={route.screen === item.screen ? "page" : undefined}>{item.label}</Link>)}
    </nav>
    <section className="statusbar"><span className={status?.recovery_required ? "dot error" : "dot"} />
      <span>정책: {status?.policy || "…"}</span>
      {status?.policy === "manual" && <span className="notice">작업 접수 후 관리자의 실행 허가가 필요합니다.</span>}
      {status?.error?.message && <span className="notice error-text">{status.error.message}</span>}
    </section>
    {error && <div className="errorbox"><span>{error}</span><button onClick={() => setError("")}>닫기</button></div>}
    <div className="workspace">
      {/* UIX06A: the panels are hidden, never unmounted. A route change is a change of what is
          *visible*, not a remount — the compose session, its in-flight request, the receipt and
          every input keep their identity, which is the whole point of keeping the editor mounted
          under the router. `hidden` also removes them from the tab order, so the keyboard cannot
          reach a screen that is not on show. */}
      <section className="panel composer" hidden={!showsPanel(route.screen, "composer")}><div className="section-title"><h2>새 이미지</h2><span>{activeModel?.verification_status || "모델 선택"}</span></div>
        <form onSubmit={submit}>
          <label>모델<select value={settings.modelId} onChange={(event) => chooseModel(event.target.value)}>
            <option value="">모델 선택</option>{models.map((model) => <option key={model.model_id} value={model.model_id} disabled={!model.execution_enabled}>{model.display_name}{model.execution_enabled ? "" : " · 사용 불가"}</option>)}
          </select></label>
          <div className="prompt-paths" role="group" aria-label="프롬프트 입력 경로">
            <button type="button" className="quiet" aria-expanded={composePathOpen}
              aria-current={composePathOpen ? "true" : undefined}
              aria-controls="compose-path"
              onClick={() => openPath("compose")}>한글 장면으로 만들기</button>
            <button type="button" className="quiet"
              aria-current={composePathOpen ? undefined : "true"}
              aria-controls="prompt-final"
              onClick={() => openPath("final")}>최종 프롬프트 직접 입력</button>
            <span className="prompt-paths__hint">
              한글 장면은 사전 초안과 영어 후보를 만들어 최종 프롬프트에 적용하고, 직접 입력은 그 필드로 바로 이동합니다. 두 값은 전환해도 그대로 남습니다.
            </span>
          </div>
          {!compositionSupported && <p className="prompt-notice" data-tone="caution">서버가 구성 이력 저장을 지원하지 않거나 확인할 수 없습니다. 최종 프롬프트만 저장됩니다.</p>}
          {remainderDowngraded && <p className="prompt-notice" data-tone="caution">서버가 번역 기록(v2)을 지원하지 않아 이번 저장에는 포함한 번역이 빠집니다. 최종 프롬프트에는 그대로 남습니다.</p>}
          {composeRestoreNotice && <p className="prompt-notice" data-tone="caution" role="status">{composeRestoreNotice}<button type="button" onClick={() => setComposeRestoreNotice(null)}>닫기</button></p>}
          {/*
            UIX01: the Korean path folds but is never unmounted. Folding is the `hidden`
            attribute on the wrapper, so the composer's session — brief, chips, candidates,
            an in-flight request — survives a trip to the English field and back, and no
            toggle can resend. `ComposePanel` writes the final prompt only from one
            candidate's apply press.
          */}
          {/*
            UIX03: while the Korean region is folded, the strip is the only place the compose
            state exists on screen. It reads and links; it never applies a candidate, never
            writes the prompt and never moves focus on its own — a reply arriving while folded
            must leave the user's typing and cursor exactly where they were.
          */}
          {!composePathOpen && composeStrip && <p className="compose-strip" data-phase={composeStrip.phase}>
            <span className="compose-strip__text">{composeStrip.text}</span>
            <button type="button" className="quiet" onClick={() => openPath("compose")}>
              한글 장면으로 돌아가기
            </button>
          </p>}
          <div id="compose-path" className="compose-path" ref={composeRegionRef} hidden={!composePathOpen}>
            <ComposePanel
              capability={composeCapability}
              target={composeTarget}
              negativeSupported={negativeEnabled}
              prompt={settings.prompt}
              negative={settings.negativePrompt}
              appliedPrompt={composedApplied}
              onApply={applyComposedPrompt}
              onRestore={restoreComposedPrompt}
              onAppliedChange={setComposeRecord}
              send={composeCapability.supported ? (body, signal) => api.compose(body, signal) : undefined}
              examples={COMPOSE_EXAMPLES}
              onUseDirectInput={() => openPath("final")}
              onStatusChange={setComposeStatus}
            />
          </div>
          {/* UIX01: the dictionary draft is an advanced tool that writes the final prompt, so it sits next to that field and stays reachable whichever path is in front. */}
          <PromptBuilder compositionSupported={compositionSupported} remainderSupported={remainderSupported} family={activeModel?.family ?? ""} value={settings.prompt}
            onChange={(prompt) => { setPromptDirty(true); setSettings((old) => ({ ...old, prompt })); }}
            state={builder} setState={setBuilder}
            proposalCapability={proposalCapability}
            sendProposal={proposalCapability.supported ? (body, signal) => api.proposals(body, signal) : undefined} />
          <label>최종 프롬프트<textarea id="prompt-final" ref={finalPromptRef} aria-invalid={showPromptIssues && promptIssues.length > 0} aria-describedby="prompt-errors" value={settings.prompt} onChange={(event) => { setPromptDirty(true); setSettings({ ...settings, prompt: event.target.value }); }} onBlur={() => setPromptBlurred(true)} placeholder="장면, 피사체, 조명, 스타일을 설명하세요." rows={5} /></label>
          <div id="prompt-errors" role="status"><p className="prompt-hint">{characterCount(settings.prompt)}/8000자</p>{promptHint && <p className="prompt-hint">{promptHint}</p>}{showPromptIssues && promptIssues.map((issue, index) => <p className="prompt-error" key={index}>{issue.message}</p>)}</div>
          <label className={negativeEnabled ? "" : "disabled"}>Negative prompt<textarea id="prompt-negative" aria-invalid={negativeIssues.length > 0} aria-describedby="negative-errors" disabled={!negativeEnabled} value={settings.negativePrompt} onChange={(event) => setSettings({ ...settings, negativePrompt: event.target.value })} placeholder={negativeEnabled ? "제외할 요소를 입력하세요." : "이 모델의 현재 CFG에서는 negative prompt를 사용할 수 없습니다."} rows={2} /></label>
          <div id="negative-errors" role="status">{negativeIssues.map((issue, index) => <p className="prompt-error" key={index}>{issue.message}</p>)}</div>
          {/* UIX04: the negative condition stays next to the input it constrains, not inside the
              fold — a limit the user cannot see where it applies is a limit they will hit. */}
          {negativeOption && <p className="option-note">Negative prompt: {optionStatus(negativeOption)}{requiredCfg && ` · CFG ${requiredCfg.join(" / ")}에서만 사용 가능`}{negativeOption.note && ` · ${negativeOption.note}`}</p>}
          <div className="chips">{activeModel && Object.keys(activeModel.presets).map((name) => <button type="button" className={settings.preset === name ? "selected" : ""} key={name} onClick={() => choosePreset(name)}>{name}{activeModel.presets[name].validation_status === "experimental" ? " · experimental" : ""}</button>)}</div>
          <div className="grid2"><label>해상도<select id="prompt-resolution" value={settings.resolution} onChange={(event) => setSettings({ ...settings, resolution: event.target.value })}>{activeModel?.supported_resolutions.map(([width, height]) => <option key={`${width}x${height}`}>{width}x{height}</option>)}</select></label><label>수량<input id="prompt-batch" type="number" min="1" max="16" value={settings.batchCount} onChange={(event) => setSettings({ ...settings, batchCount: Number(event.target.value) })} /></label></div>
          {/* UIX04: Steps/CFG/Seed fold, the summary does not. The summary is what makes the fold
              safe: the values keep being the ones the next request will use, and the user can read
              them without opening anything. It is derived from `settings`, so a manual edit after a
              preset press shows the edit, not the preset. */}
          <div className="prompt-settings__row">
            <button type="button" className="quiet prompt-settings__toggle" aria-expanded={settingsOpen}
              aria-controls="prompt-settings" onClick={() => setSettingsOpen((open) => !open)}>
              세부 생성 설정 {settingsOpen ? "접기" : "펼치기"}
            </button>
            <p className="prompt-settings__summary" data-open={settingsOpen ? "true" : undefined}>{detail.text}</p>
          </div>
          <div id="prompt-settings" className="prompt-settings" hidden={!settingsOpen}>
            <div className="grid3">
              <label>Steps<input id="prompt-steps"
                aria-invalid={hasIssue("steps")} aria-describedby="settings-errors"
                type="number" min="1" max="100" value={settings.steps} onChange={(event) => setSettings({ ...settings, steps: Number(event.target.value) })} /></label>
              <label>CFG{cfgEditable && cfgOption?.allowed_values.length
                ? <select id="prompt-cfg"
                    aria-invalid={hasIssue("cfg_scale")} aria-describedby="settings-errors"
                    value={settings.cfgScale} onChange={(event) => { const cfgScale = Number(event.target.value); setSettings((old) => ({ ...old, cfgScale, negativePrompt: requiredCfg?.includes(cfgScale) ? old.negativePrompt : "" })); }}>{cfgOption.allowed_values.map((value) => <option key={String(value)} value={String(value)}>{value}</option>)}</select>
                : <input id="prompt-cfg"
                    aria-invalid={hasIssue("cfg_scale")} aria-describedby="settings-errors"
                    disabled={!cfgEditable} type="number" min={cfgOption?.minimum ?? 0} max={cfgOption?.maximum ?? 30} step="0.1" value={settings.cfgScale} onChange={(event) => { const cfgScale = Number(event.target.value); setSettings((old) => ({ ...old, cfgScale, negativePrompt: requiredCfg?.includes(cfgScale) ? old.negativePrompt : "" })); }} />}</label>
              <label>Seed<input id="prompt-seed"
                aria-invalid={seedProblem !== null} aria-describedby="settings-errors"
                value={settings.seed} onChange={(event) => setSettings({ ...settings, seed: event.target.value })} /></label>
            </div>
            {cfgOption && <p className="option-note">CFG: {optionStatus(cfgOption)}{cfgOption.note && ` · ${cfgOption.note}`}</p>}
            {generationOptions && <div className="fixed-options"><span>Sampler: {fixedValue(samplingOption, "CLI 기본값")} · {optionStatus(samplingOption)}</span><span>Scheduler: {fixedValue(schedulerOption, "CLI 기본값 (생략)")} · {optionStatus(schedulerOption)}</span></div>}
            {/* Only the seed's own message is repeated here. The CFG/Steps limits are enforced by
                the fields' own `min`/`max` and by the server, so this box must not invent a second
                verdict about them — that is how two error lists start disagreeing. */}
            <div id="settings-errors" role="status">{seedProblem && <p className="prompt-error">{seedProblem.message}</p>}</div>
          </div>
          <div role="status">{otherIssues.map((issue, index) => <p className="prompt-error" key={index}>저장할 구성/요청 · {issue.field}: {issue.message} 선택·설명을 수정한 뒤 초안을 다시 적용하세요.</p>)}</div>
          {maxBodyBytes === null && <p className="prompt-hint">서버 요청 크기 한도를 확인할 수 없어 전체 바이트 제한은 서버에서 검사합니다.</p>}
          {/* UIX04: the first blocking reason, right next to the button it blocks, with the move
              that resolves it. `blocker` is the same `submissionIssues` list the button's own
              `disabled` reads, so fixing the field removes this line without any extra bookkeeping
              — and no second validator can disagree with the button. Tone is neutral while the
              prompt is merely untouched: a blank first visit is not a mistake the user made. */}
          {blocker && blockerVisible && <p className="generate-blocker" data-field={blocker.field}
            role="status" id="generate-blocker">
            <span className="generate-blocker__text">생성할 수 없습니다 · {FIELD_LABEL[blocker.field] ?? blocker.field}: {blocker.message}
              {FIELD_IN_DETAILS.includes(blocker.field) && !settingsOpen ? " (세부 생성 설정을 펼칩니다)" : ""}</span>
            <button type="button" className="quiet" onClick={() => moveToField(blocker.field)}>수정 위치로 이동</button>
          </p>}
          <button className="generate" disabled={submitting || !activeModel?.execution_enabled || allIssues.length > 0}>{submitting ? "접수 중…" : settings.batchCount > 1 ? `${settings.batchCount}개 생성` : "이미지 생성"}</button>
          {/* UIX05: the receipt sits under the button that produced it, and is rendered from
              the POST's reply alone. It therefore survives a `/jobs` failure, and its absence
              means "nothing was accepted", never "the list did not load". Nothing here moves
              focus or scrolls: seeing the queue is the button's explicit job. */}
          {receipt && <p className="generate-receipt" role="status" id="generate-receipt">
            <span className="generate-receipt__text" title={receipt.jobId}>
              {receiptText(receipt.jobId, receipt.status)}
            </span>
            <button type="button" className="quiet" onClick={() => void showInQueue(receipt.jobId)}>작업 큐에서 보기</button>
          </p>}
        </form>
      </section>
      <section className="panel jobs" hidden={!showsPanel(route.screen, "jobs")} data-collapsed={queueOpen ? undefined : "true"}><div className="section-title jobs-title"><h2>작업 큐</h2>
        <span className="jobs-counts" role="status">{queueLine}</span>
        <div className="jobs-actions">
          <button className="quiet" aria-expanded={queueOpen} aria-controls="jobs-body" onClick={() => setJobsExpanded(!queueOpen)}>{queueOpen ? "접기" : "펼치기"}</button>
          <button className="quiet" onClick={() => void refresh()}>새로고침</button>
        </div>
      </div>
      <div id="jobs-body" className="jobs-body" hidden={!queueOpen}>
        {/* UIX05: the locating message lives above the list it describes, and names the retry
            path when the answer is "not here" or "could not read". It never points at another
            job: the highlight below is the only thing that says which card is the one. */}
        {/* UIX06A: a permalink whose job could not be read. The URL is kept — it is what the
            user asked for — and the way out is the list, not a different job. */}
        {jobLookupFailure && <p className="jobs-nav" role="status" data-phase="missing">
          <span className="jobs-nav__text">{jobLookupFailure}</span>
          <button className="quiet" onClick={() => navigate(artPath.jobs())}>작업 큐로 이동</button>
        </p>}
        {navMessage && <p className="jobs-nav" role="status" data-phase={queueNav?.phase}>
          <span className="jobs-nav__text">{navMessage}</span>
          {queueNav && (queueNav.phase === "missing" || queueNav.phase === "error") &&
            <button className="quiet" onClick={() => void showInQueue(queueNav.jobId)}>다시 조회</button>}
        </p>}
        {api && jobs.length ? <>{jobs.map((job) => <JobCard key={job.job_id} job={job} api={api} refresh={refresh}
          spotlight={queueNav?.phase === "found" && queueNav.jobId === job.job_id} />)}<Pagination page={jobPage} hasNext={jobs.length === JOBS_PER_PAGE} onPage={changeJobPage} /></> : <p className="empty">최근 작업이 없습니다.</p>}
      </div>
      <p className="jobs-footnote" role="note">실행 {queue.running} · 대기 {queue.queued} · 완료 {queue.completed} · 실패 {queue.failed}</p>
      </section>
    </div>
    <section className="panel gallery" hidden={!showsPanel(route.screen, "gallery")}><div className="section-title"><h2 ref={galleryHeadingRef} tabIndex={-1}>{showArchived ? "NSFW 보관함" : "NSFW 갤러리"}</h2><span>{assets.length} assets</span><button className="quiet" onClick={toggleArchived}>{showArchived ? "갤러리" : "보관함"}</button></div>
    {/* UIX06A: a pasted image link that could not be resolved says so here, next to the gallery
        it belongs to, and offers the list. No other image is opened in its place. */}
    {imageLookupFailure && <p className="jobs-nav" role="status" data-phase="missing">
      <span className="jobs-nav__text">{imageLookupFailure}</span>
      <button className="quiet" onClick={() => { setImageLookupFailure(null); navigate(artPath.gallery({ archived: showArchived }), { replace: true }); }}>갤러리로 이동</button>
    </p>}
    {assets.length ? <><div className="asset-grid">{assets.map((asset) => <div className="asset" key={asset.asset_id}><button className="asset-image" onClick={(event) => openViewer(asset, event.currentTarget)} aria-label={`이미지 보기 · ${asset.asset_id.slice(0, 8)}`}>{assetUrls[asset.asset_id] ? <img src={assetUrls[asset.asset_id]} alt="생성 결과" /> : missingAssetIds[asset.asset_id] ? <span>이미지를 찾을 수 없음</span> : <span>불러오는 중…</span>}</button><div className="asset-footer"><small>{asset.asset_id.slice(0, 8)} · {date(asset.created_at)}</small><button className="quiet" onClick={(event) => openMetadata(asset, event.currentTarget)} aria-label={`정보 · ${asset.asset_id.slice(0, 8)}`}>정보</button></div></div>)}</div><Pagination page={assetPage} hasNext={assets.length === ASSETS_PER_PAGE} onPage={changeAssetPage} /></> : <p className="empty">{showArchived ? "보관된 이미지가 없습니다." : "아직 저장된 NSFW 결과가 없습니다."}</p>}</section>
    {/* UIX06A: the dialogs are driven by the URL, so a permalink opens the same dialog a click
        does. `viewedId`/`metadata` are the *loaded* resource, not the authority on what is open:
        a direct entry loads them in the effect above. */}
    {route.imageId && !route.metadata && viewedId === route.imageId &&
      <ImageViewer api={api} initialAssets={assets} initialPage={assetPage} initialId={route.imageId} archived={showArchived} close={closeViewer} />}
    {route.imageId && route.metadata && metadata && selectedAsset &&
      <Metadata data={metadata} archived={Boolean(selectedAsset.archived_at)} close={closeMetadata} reuse={reuse} changeArchive={changeArchive} destroy={destroySelected} busy={metadataBusy} failure={metadataFailure} />}
  </main>;
}


export default App;
