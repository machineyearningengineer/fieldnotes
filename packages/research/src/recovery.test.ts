import { expect, it } from "vitest";
import { decodeSnapshot, error, type Source } from "@valyu-research/contracts";
import {
  ResearchService,
  createRecord,
  appendReportBlock,
  type TaskRecord,
  type TaskStore,
  type ResearchProviders,
  type CostReceipt,
  usageExposure,
} from "./index.ts";
const source: Source = {
  id: "s1",
  title: "Evidence",
  url: "https://example.org/paper",
  authors: [],
  publishedAt: null,
  sourceType: "paper",
  excerpt: "A retained supporting passage.",
  relevance: "Relevant",
  metadata: {},
  queryIds: ["q1"],
};
const input = {
  schemaVersion: 1,
  kind: "compare",
  question: "Compare evidence",
  alternatives: ["A", "B"],
} as const;
function harness() {
  let record = createRecord(
    { ...input, alternatives: [...input.alternatives] },
    "owner",
    "success",
  );
  const store: TaskStore = {
    async accept(value) {
      record = value;
      return value.snapshot;
    },
    async get() {
      return structuredClone(record);
    },
    async recent() {
      return [];
    },
    async pending() {
      return [];
    },
    async markDelivered() {},
    async claim() {
      record = { ...record, epoch: record.epoch + 1, attempts: record.attempts + 1 };
      return structuredClone(record);
    },
    async change(_id, epoch, update) {
      if (epoch !== record.epoch) return null;
      record = update(structuredClone(record));
      decodeSnapshot(record.snapshot.id, record.snapshot);
      return structuredClone(record);
    },
  };
  const receipts = new Map<string, CostReceipt>();
  const calls: string[] = [];
  const providers: ResearchProviders = {
    simulation: false,
    receipt: (key) => receipts.get(key),
    async search(q) {
      calls.push(q.id);
      receipts.set(q.id, {
        complete: true,
        costMicros: 100,
        basis: "provider_measured",
        detail: "Measured",
      });
      return [source];
    },
    async synthesise(_i, _s, _c, _signal, emit, operate) {
      await operate!("model", 60000, async () => {
        calls.push("model");
        receipts.set("model", {
          complete: true,
          costMicros: 1000,
          basis: "estimate",
          detail: "Tokens",
        });
      });
      await emit("## Answer\n\nSupported [1](https://example.org/paper).", "section-1");
    },
  };
  return {
    store,
    providers,
    receipts,
    calls,
    get: () => record,
    set: (r: TaskRecord) => {
      record = r;
    },
  };
}
const held = (
  id: string,
  service: "search" | "model",
  state: "settled" | "unknown",
  costMicros: number | null,
) => ({
  operationId: id,
  service,
  state,
  reservedMicros: service === "search" ? 10000 : 60000,
  costMicros,
  basis: "provider_measured" as const,
  detail: "Previous attempt",
});

it("accounts nested passage checks independently without releasing an uncertain generation hold", async () => {
  const h = harness();
  h.providers.synthesise = async (_input, _sources, _scenario, _signal, emit, operate) =>
    operate!("model", 60000, async () => {
      h.receipts.set("model", {
        complete: false,
        costMicros: 1000,
        basis: "estimate",
        detail: "Partial stream",
      });
      await operate!("support-1", 9000, async () => {
        h.receipts.set("support-1", {
          complete: true,
          costMicros: 500,
          basis: "estimate",
          detail: "Passage check",
        });
      });
      await emit("## Evidence\n\nSupported [1](https://example.org/paper).");
      throw error("INVALID_REPORT", "Interrupted generation", 502);
    });
  const r = h.get();
  await new ResearchService(h.store, h.providers).run(r.snapshot.id, "worker");
  expect(h.get().snapshot.status).toBe("failed");
  expect(h.get().journal?.writeComplete).not.toBe(true);
  const model = h.get().snapshot.usage.filter((entry) => entry.service === "model");
  expect(model).toMatchObject([
    { state: "unknown", reservedMicros: 60000, costMicros: 1000 },
    { state: "settled", reservedMicros: 9000, costMicros: 500 },
  ]);
  expect(usageExposure(model)).toBe(60500);
});

it("retains web sources but spends no generation allowance on a comparison without research records", async () => {
  const h = harness();
  h.providers.search = async (query) => {
    h.receipts.set(query.id, {
      complete: true,
      costMicros: 100,
      basis: "provider_measured",
      detail: "Measured",
    });
    return [
      {
        ...source,
        sourceType: "website",
        metadata: { providerSource: "web" },
        queryIds: [query.id],
      },
    ];
  };
  const r = h.get();
  await new ResearchService(h.store, h.providers).run(r.snapshot.id, "worker");
  expect(h.calls).not.toContain("model");
  expect(h.get().snapshot.error?.code).toBe("NO_EVIDENCE");
  expect(h.get().snapshot.sources).toHaveLength(1);
  expect(h.get().snapshot.usage.every((entry) => entry.service === "search")).toBe(true);
});

it("starts independent searches together, settles every outcome and preserves deterministic provenance", async () => {
  for (const failThird of [false, true]) {
    const h = harness();
    const releases = new Map<string, () => void>();
    let allStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      allStarted = resolve;
    });
    h.providers.search = async (query) => {
      h.calls.push(query.id);
      await new Promise<void>((resolve) => {
        releases.set(query.id, resolve);
        if (releases.size === 3) allStarted();
      });
      if (failThird && query.id === "q3") throw error("SEARCH_TIMEOUT", "Uncertain search", 504);
      h.receipts.set(query.id, {
        complete: true,
        costMicros: 100,
        basis: "provider_measured",
        detail: "Measured",
      });
      return [{ ...source, title: query.id, queryIds: [query.id] }];
    };
    const r = h.get();
    const run = new ResearchService(h.store, h.providers).run(r.snapshot.id, "worker");
    await started;
    expect(h.calls).toEqual(["q1", "q2", "q3"]);
    releases.get("q3")!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.get().snapshot.status).toBe("running");
    releases.get("q2")!();
    releases.get("q1")!();
    await run;
    expect(h.get().snapshot.status).toBe(failThird ? "failed" : "succeeded");
    expect(h.get().snapshot.sources[0]).toMatchObject({
      title: "q1",
      queryIds: failThird ? ["q1", "q2"] : ["q1", "q2", "q3"],
    });
    expect(h.get().snapshot.usage.filter((entry) => entry.service === "search")).toHaveLength(3);
    if (failThird) {
      expect(h.calls).not.toContain("model");
      expect(
        h.get().snapshot.usage.find((entry) => entry.operationId.includes(":q3:")),
      ).toMatchObject({ state: "unknown", reservedMicros: 10000 });
    }
  }
});
it("resumes committed searches, retaining an uncertain search charge inside the task bound", async () => {
  const h = harness();
  const r = h.get();
  r.snapshot.queries[0]!.status = "complete";
  r.snapshot.sources = [source];
  r.snapshot.usage = [
    held("q1-old", "search", "settled", 100),
    held("q2-old", "search", "unknown", null),
  ];
  h.set(r);
  await new ResearchService(h.store, h.providers).run(r.snapshot.id, "replacement");
  expect(h.calls).toEqual(["q2", "q3", "model"]);
  expect(h.get().snapshot.status).toBe("succeeded");
  expect(h.get().snapshot.usage.find((u) => u.operationId === "q2-old")).toMatchObject({
    state: "unknown",
    reservedMicros: 10000,
    costMicros: null,
  });
});
it("finalizes a durably complete model without paying to regenerate its blocks", async () => {
  const h = harness();
  let r = h.get();
  r.searchCheckpoint = [source];
  r.snapshot.sources = [source];
  r = appendReportBlock(r, "## Answer\n\nSupported [1](https://example.org/paper).");
  r.journal = { writeComplete: true };
  h.set(r);
  await new ResearchService(h.store, h.providers).run(r.snapshot.id, "replacement");
  expect(h.calls).toEqual([]);
  expect(h.get().snapshot.status).toBe("succeeded");
});
it("never buys another model call when the previous outcome is unknown", async () => {
  const h = harness();
  const r = h.get();
  r.searchCheckpoint = [source];
  r.snapshot.sources = [source];
  r.snapshot.usage = [held("model-old", "model", "unknown", null)];
  h.set(r);
  await new ResearchService(h.store, h.providers).run(r.snapshot.id, "replacement");
  expect(h.calls).toEqual([]);
  expect(h.get().snapshot.error?.message).toContain("uncertain charges remain reserved");
  expect(h.get().snapshot.outcome).toBe("failed");
  expect(h.get().snapshot.usage[0]!.reservedMicros).toBe(60000);
});
it("hands a confirmed-free rejection back to the queue, and fails an uncertain or final one", async () => {
  for (const [confirmed, priorAttempts] of [
    [true, 0],
    [false, 0],
    [true, 2],
  ] as const) {
    const h = harness();
    const r = h.get();
    r.searchCheckpoint = [source];
    r.snapshot.sources = [source];
    r.attempts = priorAttempts;
    h.set(r);
    let calls = 0;
    h.providers.synthesise = async (_i, _s, _c, _signal, emit, operate) => {
      await operate!("model", 60000, async () => {
        if (++calls === 1) {
          if (confirmed)
            h.receipts.set("model", {
              complete: true,
              costMicros: 0,
              basis: "provider_measured",
              detail: "Rejected before stream, uncharged",
            });
          throw error("RATE_LIMITED", "Temporarily unavailable", 503, true);
        }
        h.receipts.set("model", {
          complete: true,
          costMicros: 1000,
          basis: "estimate",
          detail: "Tokens",
        });
      });
      await emit("## Answer\n\nSupported [1](https://example.org/paper).");
    };
    const service = new ResearchService(h.store, h.providers);
    await service.run(r.snapshot.id, "worker");
    const requeued = confirmed && priorAttempts === 0;
    expect(h.get().snapshot.status).toBe(requeued ? "running" : "failed");
    if (!requeued) continue;
    expect(h.get().leaseOwner).toBeNull();
    expect(h.get().snapshot.usage.find((u) => u.service === "model")).toMatchObject({
      state: "settled",
      costMicros: 0,
    });
    // Cloud Tasks redelivers; the step runner resumes and the second call succeeds.
    await service.run(r.snapshot.id, "redelivery");
    expect(calls).toBe(2);
    expect(h.get().snapshot.status).toBe("succeeded");
  }
});

it("fails visibly when a free rejection hides an uncertain sibling search", async () => {
  const h = harness();
  h.providers.search = async (q) => {
    if (q.id === "q1") {
      h.receipts.set("q1", {
        complete: true,
        costMicros: 0,
        basis: "provider_measured",
        detail: "Rate limited, free",
      });
      throw error("RATE_LIMITED", "Rate limited", 503, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw error("SEARCH_TIMEOUT", "Timed out; cost unknown", 504, true);
  };
  await new ResearchService(h.store, h.providers).run(h.get().snapshot.id, "worker");
  expect(h.get().snapshot.status).toBe("failed");
  expect(h.get().snapshot.usage.some((u) => u.state === "unknown")).toBe(true);
});

it("resumes a saved draft without another model call, reusing saved checks and published blocks", async () => {
  const h = harness();
  let r = h.get();
  r.searchCheckpoint = [source];
  r.snapshot.sources = [source];
  r = appendReportBlock(r, "## First\n\nSupported [1](https://example.org/paper).");
  r.journal = {
    draft: ["line-1", "line-2"],
    checks: { "support-1": { verdicts: ["supported"], coverage: [["f1"]] } },
    published: ["section-1"],
  };
  r.snapshot.usage = [held("model-old", "model", "settled", 1000)];
  h.set(r);
  let resumed: unknown;
  h.providers.synthesise = async (_i, _s, _c, _signal, emit, operate, journal) => {
    resumed = { draft: journal?.draft, checks: journal?.checks };
    if (!journal?.draft) await operate!("model", 60000, async () => h.calls.push("model"));
    await emit("## First\n\nSupported [1](https://example.org/paper).", "section-1");
    await emit("## Second\n\nAlso supported [1](https://example.org/paper).", "section-2");
  };
  await new ResearchService(h.store, h.providers).run(r.snapshot.id, "replacement");
  expect(resumed).toEqual({
    draft: ["line-1", "line-2"],
    checks: { "support-1": { verdicts: ["supported"], coverage: [["f1"]] } },
  });
  expect(h.calls).toEqual([]);
  expect(h.get().snapshot.status).toBe("succeeded");
  expect(h.get().snapshot.report?.match(/## First/g)).toHaveLength(1);
  expect(h.get().snapshot.report).toContain("## Second");
  expect(h.get().journal?.published).toEqual(["section-1", "section-2"]);
  expect(h.get().snapshot.outcome).toBe("answered");
});
