import { Effect } from "effect";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { researchRecord, synthesisSources } from "./grounding.ts";
import {
  MAX_DELIVERY_ATTEMPTS,
  RESEARCH_BUDGET,
  TaskLedger,
  closeReserved,
  interruptReserved,
  type CostReceipt,
} from "./ledger.ts";
export {
  MAX_DELIVERY_ATTEMPTS,
  RESEARCH_BUDGET,
  TaskLedger,
  closeReserved,
  interruptReserved,
  reserve,
  usageExposure,
  type CostReceipt,
} from "./ledger.ts";
import {
  AppError,
  error,
  terminal,
  type ProgressEvent,
  type ReportBlock,
  type SearchQuery,
  type Source,
  type TaskInput,
  type TaskSnapshot,
  type Outcome,
} from "@valyu-research/contracts";

export interface TaskRecord {
  snapshot: TaskSnapshot;
  owner: string;
  requestHash: string;
  scenario: string;
  deadlineMs: number;
  epoch: number;
  leaseOwner: string | null;
  leaseUntilMs: number;
  attempts: number;
  dispatchGeneration: number;
  dispatchState: "pending" | "delivered";
  searchCheckpoint: Source[] | null;
  /** Write-step checkpoints: saved draft lines, saved check results and published block keys. */
  journal?: WriteJournal;
  /** Step and provider-call spans, exported under the task trace when it finishes. */
  spans?: TraceSpan[];
}
export type TraceSpan = {
  name: string;
  startMs: number;
  endMs: number;
  ok: boolean;
  attributes: Record<string, string>;
};
export type CheckResult = { verdicts: string[]; coverage: string[][] };
export interface WriteJournal {
  draft?: string[];
  checks?: Record<string, CheckResult>;
  published?: string[];
  writeComplete?: boolean;
  outcome?: Exclude<Outcome, "failed">;
}
/** Lets the writer resume from saved output instead of paying for it again. */
export interface SynthesisJournal {
  draft?: string[];
  checks: Record<string, CheckResult>;
  saveDraft(lines: string[]): Promise<void>;
  saveCheck(key: string, result: CheckResult): Promise<void>;
}
export interface TaskStore {
  accept(record: TaskRecord, keyHash: string): Promise<TaskSnapshot>;
  get(id: string): Promise<TaskRecord | null>;
  recent(owner: string): Promise<TaskSnapshot[]>;
  pending(): Promise<TaskRecord[]>;
  claim(id: string, workerId: string): Promise<TaskRecord | null>;
  change(
    id: string,
    epoch: number,
    update: (record: TaskRecord) => TaskRecord,
  ): Promise<TaskRecord | null>;
  markDelivered(id: string): Promise<void>;
}
export type ModelOperation = <T>(
  key: string,
  allowanceMicros: number,
  call: () => Promise<T>,
) => Promise<T>;
export interface ResearchProviders {
  receipt?(key: string): CostReceipt | undefined;
  search(
    query: SearchQuery,
    input: TaskInput,
    scenario: string,
    signal: AbortSignal,
  ): Promise<Source[]>;
  synthesise(
    input: TaskInput,
    sources: Source[],
    scenario: string,
    signal: AbortSignal,
    emit: (markdown: string, key?: string) => Promise<void>,
    modelOperation?: ModelOperation,
    journal?: SynthesisJournal,
  ): Promise<{ outcome: Exclude<Outcome, "failed"> } | void>;
  timings?(): Record<string, number>;
  simulation: boolean;
}
export function planSearches(input: TaskInput): SearchQuery[] {
  const sides = input.kind === "compare" ? input.alternatives : [];
  const plans =
    input.kind === "compare"
      ? [
          {
            query: `${sides[0]} ${input.question}`,
            purpose: `Evidence for ${sides[0]}`,
            sourceType: "academic" as const,
          },
          {
            query: `${sides[1]} ${input.question}`,
            purpose: `Evidence for ${sides[1]}`,
            sourceType: "academic" as const,
          },
          {
            query: `${sides.join(" versus ")} ${input.question} limitations comparative studies`,
            purpose: "Comparable conditions and limitations",
            sourceType: "web" as const,
          },
        ]
      : [
          {
            query: input.question,
            purpose: "Direct evidence and primary publications",
            sourceType: "web" as const,
          },
          {
            query: `${input.question} limitations conflicting evidence`,
            purpose: "Look for uncertainty and disagreement",
            sourceType: "academic" as const,
          },
        ];
  return plans.map((plan, index) => ({
    id: `q${index + 1}`,
    ...plan,
    query: plan.query.slice(0, 500),
    sourceType: plan.sourceType,
    status: "planned",
    sourceIds: [],
  }));
}
/** Deterministic query priority and complete provenance, independent of network completion order. */
export function mergeSources(
  current: readonly Source[],
  incoming: readonly Source[],
  queryOrder: readonly string[],
): Source[] {
  const priority = (source: Source) =>
    Math.min(
      queryOrder.length,
      ...source.queryIds.map((id) => {
        const index = queryOrder.indexOf(id);
        return index < 0 ? queryOrder.length : index;
      }),
    );
  const merged = new Map(current.map((source) => [source.id, source]));
  for (const source of incoming) {
    const previous = merged.get(source.id);
    const [kept, other] =
      previous && priority(source) < priority(previous) ? [source, previous] : [previous, source];
    // Citation order follows query priority, but a scholarly classification from either copy is kept.
    const classified =
      kept && !researchRecord(kept) && researchRecord(other!)
        ? {
            ...kept,
            sourceType: other!.sourceType,
            metadata: { ...kept.metadata, providerSource: other!.metadata.providerSource },
          }
        : kept;
    merged.set(
      source.id,
      previous
        ? {
            ...classified!,
            queryIds: [...new Set([...previous.queryIds, ...source.queryIds])].sort(
              (a, b) => queryOrder.indexOf(a) - queryOrder.indexOf(b),
            ),
          }
        : source,
    );
  }
  const rank = (source: Source) =>
    Number.isInteger(source.metadata.retrievalRank) ? Number(source.metadata.retrievalRank) : 99;
  return [...merged.values()]
    .sort((a, b) => priority(a) - priority(b) || rank(a) - rank(b) || a.id.localeCompare(b.id))
    .slice(0, 8);
}
export function createRecord(input: TaskInput, owner: string, scenario: string): TaskRecord {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const snapshot: TaskSnapshot = {
    schemaVersion: 1,
    id: randomUUID(),
    input,
    status: "queued",
    stage: "queued",
    revision: 1,
    createdAt: at,
    updatedAt: at,
    expiresAt: new Date(now + 300_000).toISOString(),
    simulation: true,
    queries: planSearches(input),
    sources: [],
    reportDraft: null,
    report: null,
    error: null,
    usage: [],
    events: [{ sequence: 1, at, stage: "queued", message: "Research queued" }],
    traceId: randomBytes(16).toString("hex"),
    timings: {},
  };
  return {
    snapshot,
    owner,
    requestHash: hash(JSON.stringify(input)),
    scenario,
    deadlineMs: now + 300_000,
    epoch: 0,
    leaseOwner: null,
    leaseUntilMs: 0,
    attempts: 0,
    dispatchGeneration: 0,
    dispatchState: "pending",
    searchCheckpoint: null,
  };
}
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function appendReportBlock(record: TaskRecord, markdown: string): TaskRecord {
  const blocks = record.snapshot.reportDraft?.blocks ?? [];
  if (
    !markdown.trim() ||
    markdown.length > 35_000 ||
    blocks.length >= 40 ||
    blocks.reduce((sum, block) => sum + block.markdown.length, 0) +
      markdown.length +
      blocks.length * 2 >
      35_000
  )
    throw error("INVALID_REPORT", "The report exceeded its draft limit.", 502);
  const block: ReportBlock = { id: `${record.snapshot.id}:block:${blocks.length + 1}`, markdown };
  const at = new Date().toISOString();
  return {
    ...record,
    snapshot: {
      ...record.snapshot,
      reportDraft: { blocks: [...blocks, block] },
      revision: record.snapshot.revision + 1,
      updatedAt: at,
    },
  };
}
export function reportFromBlocks(blocks: readonly ReportBlock[]): string {
  return blocks.map((block) => block.markdown).join("\n\n");
}
export function validateSourceUrls(sources: readonly Source[]): void {
  for (const source of sources) {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      throw error("INVALID_REPORT", "A source URL is invalid.", 502);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw error("INVALID_REPORT", "A source URL is not allowed.", 502);
  }
}
export function validateDraftLinks(markdown: string, sources: readonly Source[]): void {
  const links = [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  if (links.some((url) => !sources.some((source) => source.url === url)))
    throw error("INVALID_REPORT", "The report contains a citation we could not verify.", 502);
}
export function validateReport(report: string, sources: Source[]): void {
  validateSourceUrls(sources);
  if (!report.trim() || report.length > 35_000)
    throw error(
      "INVALID_REPORT",
      "The report could not be checked. Please start a new question.",
      502,
    );
  const links = [...report.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  if (!links.length || links.some((url) => !sources.some((source) => source.url === url)))
    throw error("INVALID_REPORT", "The report contains a citation we could not verify.", 502);
}
const event = (record: TaskRecord, stage: TaskSnapshot["stage"], message: string): TaskRecord => {
  const at = new Date().toISOString();
  const revision = record.snapshot.revision + 1;
  const item: ProgressEvent = { sequence: revision, at, stage, message };
  return {
    ...record,
    snapshot: {
      ...record.snapshot,
      stage,
      revision,
      updatedAt: at,
      events: [...record.snapshot.events, item].slice(-40),
    },
  };
};
const asError = (cause: unknown): AppError =>
  cause instanceof AppError
    ? cause
    : error("INTERNAL", "Research stopped unexpectedly. Please start a new attempt.", 500, true);
export class ResearchService {
  readonly store: TaskStore;
  readonly providers: ResearchProviders;
  readonly observe: (value: Record<string, unknown>) => void;
  constructor(
    store: TaskStore,
    providers: ResearchProviders,
    observe: (value: Record<string, unknown>) => void = () => {},
  ) {
    this.store = store;
    this.providers = providers;
    this.observe = observe;
  }
  private note(event: string, record: TaskRecord) {
    try {
      this.observe({
        event,
        at: new Date().toISOString(),
        taskId: record.snapshot.id,
        reference: record.snapshot.traceId,
        ...(process.env.GOOGLE_CLOUD_PROJECT && !this.providers.simulation
          ? {
              "logging.googleapis.com/trace": `projects/${process.env.GOOGLE_CLOUD_PROJECT}/traces/${record.snapshot.traceId}`,
            }
          : {}),
        epoch: record.epoch,
        revision: record.snapshot.revision,
        stage: record.snapshot.stage,
        status: record.snapshot.status,
        operationId: record.snapshot.usage.at(-1)?.operationId,
        errorCode: record.snapshot.error?.code,
      });
    } catch {
      /* Diagnostics must not change a committed task outcome. */
    }
  }
  submit(input: TaskInput, owner: string, key: string, scenario = "success") {
    return Effect.tryPromise({
      try: () => {
        if (!this.providers.simulation && Date.now() >= Date.parse(RESEARCH_BUDGET.priceReviewAt))
          throw error("BUDGET_EXCEEDED", "Model pricing requires review before new research.", 503);
        const record = createRecord(input, owner, scenario);
        record.snapshot.simulation = this.providers.simulation;
        return this.store.accept(record, hash(`${owner}:${key}`));
      },
      catch: asError,
    });
  }
  async run(id: string, workerId: string): Promise<void> {
    const claimed = await this.store.claim(id, workerId);
    if (!claimed || terminal(claimed.snapshot)) return;
    this.note("task.claimed", claimed);
    const epoch = claimed.epoch;
    const controller = new AbortController();
    const remaining = Math.min(180_000, claimed.deadlineMs - Date.now());
    const timer = setTimeout(() => controller.abort(), Math.max(0, remaining));
    const started = Date.now();
    let alive = true;
    const renew = setInterval(() => {
      void this.store
        .change(id, epoch, (record) => record)
        .then((record) => {
          if (!record) {
            alive = false;
            controller.abort();
          }
        })
        .catch(() => controller.abort());
    }, 15_000);
    const change = async (update: (record: TaskRecord) => TaskRecord) => {
      if (!alive || controller.signal.aborted)
        throw error("DEADLINE_EXCEEDED", "Research reached its time limit.", 504, true);
      const next = await this.store.change(id, epoch, update);
      if (!next) {
        this.note("task.lease_lost", claimed);
        alive = false;
        controller.abort();
        throw error("CONFLICT", "Another worker owns this task.", 409);
      }
      this.note("task.checkpoint", next);
      return next;
    };
    const spans: TraceSpan[] = [];
    let finalizeStarted = Date.now();
    // Spans from this attempt are saved with its last write; earlier attempts' spans are kept.
    const withSpans = (record: TaskRecord, ...extra: TraceSpan[]): TaskRecord => ({
      ...record,
      spans: [...(record.spans ?? []), ...spans, ...extra].slice(-60),
    });
    // Every provider call goes through this one ledger: reserve, call, settle.
    const ledger = new TaskLedger({
      taskId: id,
      attempt: claimed.attempts,
      simulation: this.providers.simulation,
      receipt: (key) => this.providers.receipt?.(key),
      timings: () => this.providers.timings?.(),
      change,
      span: (span) => spans.push(span),
    });
    const perform = ledger.operate.bind(ledger);
    try {
      let state = await change((record) =>
        event(
          {
            ...record,
            snapshot: {
              ...record.snapshot,
              status: "running",
              usage: interruptReserved(
                record.snapshot.usage,
                "Worker interrupted; previous allowance retained",
              ),
              simulation: this.providers.simulation,
            },
          },
          "searching",
          "Finding relevant evidence",
        ),
      );
      let sources: Source[] = [...(state.searchCheckpoint ?? state.snapshot.sources)];
      const retrieve = async () => {
        const queries = state.snapshot.queries.filter((query) => query.status !== "complete");
        const results = await Promise.allSettled(
          queries.map(async (query) => {
            const found = await perform(query.id, "search", () =>
              this.providers.search(query, state.snapshot.input, state.scenario, controller.signal),
            );
            validateSourceUrls(found);
            await change((record) =>
              event(
                {
                  ...record,
                  snapshot: {
                    ...record.snapshot,
                    timings: {
                      ...record.snapshot.timings,
                      ...(record.snapshot.sources.length === 0 && found.length
                        ? {
                            firstSourcesMs:
                              Date.now() - new Date(record.snapshot.createdAt).getTime(),
                          }
                        : {}),
                    },
                    sources: mergeSources(
                      record.snapshot.sources,
                      found,
                      record.snapshot.queries.map((item) => item.id),
                    ),
                    queries: record.snapshot.queries.map((item) =>
                      item.id === query.id
                        ? {
                            ...item,
                            status: "complete",
                            sourceIds: found.map((source) => source.id),
                          }
                        : item,
                    ),
                  },
                },
                "searching",
                `${found.length} sources found for this search`,
              ),
            );
          }),
        );
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        const latest = await this.store.get(id);
        if (!latest || latest.epoch !== epoch)
          throw error("CONFLICT", "Another worker owns this task.", 409);
        state = latest;
        sources = [...state.snapshot.sources];
        if (!sources.length)
          throw error("NO_EVIDENCE", "No useful evidence was found. Try a narrower question.", 422);
        state = await change((record) => ({ ...record, searchCheckpoint: sources }));
      };
      const write = async () => {
        const journal = state.journal ?? {};
        // A draft interrupted mid-stream cannot be finished without buying another generation.
        if (!journal.draft && state.snapshot.reportDraft?.blocks.length)
          throw error(
            "INVALID_REPORT",
            "Writing was interrupted; the partial draft is saved. Start a new attempt.",
            502,
          );
        if (
          !journal.draft &&
          !this.providers.simulation &&
          !synthesisSources(state.snapshot.input, sources).length
        )
          throw error(
            "NO_EVIDENCE",
            "No research records were retrieved for this scientific comparison. Web sources remain available to inspect.",
            422,
          );
        await change((record) => event(record, "writing", "Putting the evidence together"));
        const saveJournal = (update: (journal: WriteJournal) => WriteJournal) =>
          change((record) => ({ ...record, journal: update(record.journal ?? {}) }));
        const written = await this.providers.synthesise(
          state.snapshot.input,
          sources,
          state.scenario,
          controller.signal,
          async (markdown, key) => {
            validateSourceUrls(sources);
            validateDraftLinks(markdown, sources);
            await change((record) => {
              // Replayed sections were already published before an interruption.
              if (key && record.journal?.published?.includes(key)) return record;
              const next = appendReportBlock(
                {
                  ...record,
                  snapshot: {
                    ...record.snapshot,
                    timings: {
                      ...record.snapshot.timings,
                      ...(record.snapshot.reportDraft?.blocks.length
                        ? {}
                        : {
                            firstBlockMs:
                              Date.now() - new Date(record.snapshot.createdAt).getTime(),
                          }),
                    },
                  },
                },
                markdown,
              );
              return key
                ? {
                    ...next,
                    journal: {
                      ...next.journal,
                      published: [...(next.journal?.published ?? []), key],
                    },
                  }
                : next;
            });
          },
          (key, allowance, call) => {
            if (!/^(model|support-[1-8])$/.test(key))
              throw error("INTERNAL", "Invalid model operation.", 502);
            return perform(key, "model", call, allowance);
          },
          {
            draft: journal.draft,
            checks: journal.checks ?? {},
            saveDraft: async (lines) => {
              await saveJournal((saved) => ({ ...saved, draft: lines }));
            },
            saveCheck: async (key, result) => {
              await saveJournal((saved) => ({
                ...saved,
                checks: { ...saved.checks, [key]: result },
              }));
            },
          },
        );
        await saveJournal((saved) => ({
          ...saved,
          writeComplete: true,
          outcome: written?.outcome ?? "answered",
        }));
      };
      const finalize = async () => {
        finalizeStarted = Date.now();
        await change((record) =>
          event(record, "checking", "Checking source links and report structure"),
        );
        const checked = await this.store.get(id);
        if (!checked || checked.epoch !== epoch)
          throw error("CONFLICT", "Another worker owns this task.", 409);
        const report = reportFromBlocks(checked.snapshot.reportDraft?.blocks ?? []);
        validateReport(report, sources);
        await change((record) => {
          const finalReport = reportFromBlocks(record.snapshot.reportDraft?.blocks ?? []);
          if (finalReport !== report)
            throw error("CONFLICT", "Report draft changed during checks.", 409);
          return event(
            {
              ...withSpans(record, {
                name: "step.finalize",
                startMs: finalizeStarted,
                endMs: Date.now(),
                ok: true,
                attributes: {},
              }),
              leaseOwner: null,
              leaseUntilMs: 0,
              snapshot: {
                ...record.snapshot,
                status: "succeeded",
                outcome: record.journal?.outcome ?? "answered",
                report,
                timings: {
                  ...record.snapshot.timings,
                  workerMs: Date.now() - started,
                  totalMs: Date.now() - new Date(record.snapshot.createdAt).getTime(),
                },
                usage: closeReserved(record.snapshot.usage, this.providers.simulation),
              },
            },
            "complete",
            "Evidence brief ready",
          );
        });
      };
      // Each step saves its output before the next starts; redelivery skips finished steps.
      const steps = [
        {
          name: "retrieve",
          done: (record: TaskRecord) => !!record.searchCheckpoint,
          run: retrieve,
        },
        {
          name: "write",
          done: (record: TaskRecord) => !!record.journal?.writeComplete,
          run: write,
        },
        {
          name: "finalize",
          done: (record: TaskRecord) => terminal(record.snapshot),
          run: finalize,
        },
      ];
      for (const step of steps) {
        const latest = await this.store.get(id);
        if (!latest || latest.epoch !== epoch)
          throw error("CONFLICT", "Another worker owns this task.", 409);
        state = latest;
        sources = [...(state.searchCheckpoint ?? state.snapshot.sources)];
        if (step.done(latest)) continue;
        const startMs = Date.now();
        try {
          await step.run();
          if (step.name !== "finalize")
            spans.push({
              name: `step.${step.name}`,
              startMs,
              endMs: Date.now(),
              ok: true,
              attributes: {},
            });
        } catch (cause) {
          spans.push({
            name: `step.${step.name}`,
            startMs,
            endMs: Date.now(),
            ok: false,
            attributes: { "error.code": cause instanceof AppError ? cause.code : "INTERNAL" },
          });
          throw cause;
        }
      }
    } catch (cause) {
      if (alive) {
        try {
          await ledger.settleOutstanding();
        } catch {
          /* Preserve the original failure and unknown reservation. */
        }
        // A confirmed-free transient rejection goes back to the queue, which redelivers with
        // backoff; the step runner then resumes from the last saved step.
        if (
          !controller.signal.aborted &&
          cause instanceof AppError &&
          cause.retryable &&
          ledger.canRequeue(cause) &&
          claimed.attempts < MAX_DELIVERY_ATTEMPTS &&
          Date.now() < claimed.deadlineMs
        ) {
          const waiting = await this.store.change(id, epoch, (record) =>
            event(
              {
                ...withSpans(record),
                leaseOwner: null,
                leaseUntilMs: Date.now() + 5_000,
                snapshot: {
                  ...record.snapshot,
                  usage: interruptReserved(
                    record.snapshot.usage,
                    "Outcome unknown; reservation retained",
                  ),
                },
              },
              record.snapshot.stage,
              "A provider was briefly unavailable; retrying shortly",
            ),
          );
          if (waiting) {
            this.note("task.requeued", waiting);
            return;
          }
        }
        const failure = controller.signal.aborted
          ? error(
              "DEADLINE_EXCEEDED",
              "Research reached its time limit. Its progress is saved.",
              504,
              true,
            )
          : asError(cause);
        const failed = await this.store.change(id, epoch, (record) =>
          event(
            {
              ...withSpans(record),
              leaseOwner: null,
              leaseUntilMs: 0,
              snapshot: {
                ...record.snapshot,
                status: "failed",
                outcome: "failed",
                error: {
                  code: failure.code,
                  message: failure.message,
                  retryable: failure.retryable,
                  traceId: record.snapshot.traceId,
                },
                usage: interruptReserved(
                  record.snapshot.usage,
                  "Outcome unknown; reservation retained",
                ),
              },
            },
            "failed",
            failure.message,
          ),
        );
        if (failed) this.note("task.failed", failed);
      }
    } finally {
      clearTimeout(timer);
      clearInterval(renew);
    }
  }
}
