import { Firestore } from "@google-cloud/firestore";
import { setTimeout as delay } from "node:timers/promises";
import {
  error,
  terminal,
  decodeSnapshot,
  type SearchQuery,
  type Source,
  type TaskInput,
  type TaskSnapshot,
} from "@valyu-research/contracts";
import {
  RESEARCH_BUDGET,
  type ModelOperation,
  type TaskRecord,
  type TaskStore,
  type ResearchProviders,
} from "@valyu-research/research";

export function localDatabase(): Firestore {
  const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
  if (!endpoint || !/^(127\.0\.0\.1|localhost):\d+$/.test(endpoint))
    throw new Error(
      "Local mode requires a loopback Firestore emulator. No cloud connection was attempted.",
    );
  process.env.METADATA_SERVER_DETECTION = "none";
  return new Firestore({
    projectId: "valyu-research-local",
    host: endpoint.split(":")[0],
    port: Number(endpoint.split(":")[1]),
    ssl: false,
    ignoreUndefinedProperties: true,
  });
}
function normalizeRecord(record: TaskRecord): TaskRecord {
  return {
    ...record,
    snapshot: { ...record.snapshot, reportDraft: record.snapshot.reportDraft ?? null },
  };
}
export class FirestoreTaskStore implements TaskStore {
  readonly db: Firestore;
  readonly launchBudgetMicros: number | null;
  constructor(db: Firestore, launchBudgetMicros: number | null = null) {
    this.db = db;
    this.launchBudgetMicros = launchBudgetMicros;
  }
  private task(id: string) {
    return this.db.collection("tasks").doc(id);
  }
  async accept(record: TaskRecord, keyHash: string): Promise<TaskSnapshot> {
    const keyRef = this.db.collection("submissionKeys").doc(keyHash);
    const dayRef = this.db.collection("admission").doc(new Date().toISOString().slice(0, 10));
    return this.db.runTransaction(async (tx) => {
      const existing = await tx.get(keyRef);
      if (existing.exists) {
        const value = existing.data() as { taskId: string; requestHash: string; owner: string };
        if (value.requestHash !== record.requestHash || value.owner !== record.owner)
          throw error("CONFLICT", "This submission key belongs to a different question.", 409);
        const saved = await tx.get(this.task(value.taskId));
        if (!saved.exists)
          throw error("INTERNAL", "The original task could not be recovered.", 500);
        return normalizeRecord(saved.data() as TaskRecord).snapshot;
      }
      const counter = await tx.get(dayRef);
      const data = counter.data() as { count?: number; active?: number } | undefined;
      if ((data?.active ?? 0) >= 3 || (data?.count ?? 0) >= 100)
        throw error(
          "RATE_LIMITED",
          "Research is busy. Please wait for a task to finish.",
          429,
          true,
        );
      if (this.launchBudgetMicros !== null) {
        const launch = this.db.collection("limits").doc("launch");
        const wallet = await tx.get(launch);
        const exposure = Number(wallet.data()?.reservedMicros ?? 0);
        if (
          !Number.isSafeInteger(exposure) ||
          exposure < 0 ||
          exposure + 100_000 > this.launchBudgetMicros
        )
          throw error("BUDGET_EXCEEDED", "The demonstration budget is used up.", 429);
        tx.set(launch, {
          reservedMicros: exposure + 100_000,
          taskCount: Number(wallet.data()?.taskCount ?? 0) + 1,
        });
      }
      tx.create(this.task(record.snapshot.id), record);
      tx.create(keyRef, {
        taskId: record.snapshot.id,
        requestHash: record.requestHash,
        owner: record.owner,
      });
      tx.set(dayRef, { count: (data?.count ?? 0) + 1, active: (data?.active ?? 0) + 1 });
      return record.snapshot;
    });
  }
  async get(id: string): Promise<TaskRecord | null> {
    const snap = await this.task(id).get();
    return snap.exists ? normalizeRecord(snap.data() as TaskRecord) : null;
  }
  async recent(owner: string): Promise<TaskSnapshot[]> {
    const result = await this.db
      .collection("tasks")
      .where("owner", "==", owner)
      .orderBy("snapshot.createdAt", "desc")
      .limit(100)
      .get();
    return result.docs
      .map((doc) => doc.data() as TaskRecord & { hiddenFromRecent?: boolean })
      .filter((record) => !record.hiddenFromRecent)
      .map((record) => ({ ...record.snapshot, reportDraft: record.snapshot.reportDraft ?? null }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);
  }
  async setRecentVisibility(id: string, owner: string, visible: boolean): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.task(id);
      const snap = await tx.get(ref);
      if (!snap.exists || (snap.data() as TaskRecord).owner !== owner)
        throw error("NOT_FOUND", "This research task is unavailable.", 404);
      tx.update(ref, { hiddenFromRecent: !visible });
    });
  }
  async pending(): Promise<TaskRecord[]> {
    const result = await this.db
      .collection("tasks")
      .where("snapshot.status", "in", ["queued", "running"])
      .limit(20)
      .get();
    return result.docs.map((doc) => normalizeRecord(doc.data() as TaskRecord));
  }
  async claim(id: string, workerId: string): Promise<TaskRecord | null> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.task(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const record = normalizeRecord(snap.data() as TaskRecord);
      const now = snap.readTime.toMillis();
      if (terminal(record.snapshot) || record.leaseUntilMs > now) return null;
      const next = {
        ...record,
        epoch: record.epoch + 1,
        leaseOwner: workerId,
        leaseUntilMs: now + 60_000,
        attempts: record.attempts + 1,
      };
      tx.set(ref, next);
      return next;
    });
  }
  async change(
    id: string,
    epoch: number,
    update: (record: TaskRecord) => TaskRecord,
  ): Promise<TaskRecord | null> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.task(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const record = normalizeRecord(snap.data() as TaskRecord);
      if (
        record.epoch !== epoch ||
        terminal(record.snapshot) ||
        record.leaseUntilMs < snap.readTime.toMillis()
      )
        return null;
      const next = update(record);
      if (next.snapshot !== record.snapshot) next.snapshot = decodeSnapshot(id, next.snapshot);
      // A worker that hands a task back to the queue releases its lease to a short explicit hold.
      next.leaseUntilMs = terminal(next.snapshot)
        ? 0
        : next.leaseOwner === null
          ? Math.min(next.leaseUntilMs, snap.readTime.toMillis() + 60_000)
          : snap.readTime.toMillis() + 60_000;
      if (terminal(next.snapshot)) {
        const dayRef = this.db.collection("admission").doc(record.snapshot.createdAt.slice(0, 10));
        const counter = await tx.get(dayRef);
        const value = counter.data() as { count?: number; active?: number } | undefined;
        tx.set(dayRef, { count: value?.count ?? 0, active: Math.max(0, (value?.active ?? 1) - 1) });
      }
      tx.set(ref, next);
      return next;
    });
  }
  async markDelivered(id: string): Promise<void> {
    await this.task(id).update({ dispatchState: "delivered" });
  }
}

export class FixtureProviders implements ResearchProviders {
  readonly simulation = true;
  async search(
    query: SearchQuery,
    input: TaskInput,
    scenario: string,
    signal: AbortSignal,
  ): Promise<Source[]> {
    await delay(700, undefined, { signal });
    if (scenario === "timeout")
      throw error(
        "SEARCH_TIMEOUT",
        "A source search timed out. Its saved task can still be inspected.",
        504,
        true,
      );
    if (scenario === "no-evidence") return [];
    const index = Number(query.id.slice(1));
    const label =
      input.kind === "compare" && index <= 2
        ? (input.alternatives[index - 1] ?? "Alternative")
        : "Evidence limitations";
    const sources: Source[] = [
      {
        id: `s${index}`,
        title:
          input.kind === "compare"
            ? `${label}: study design and reported conditions`
            : ([
                "A review to establish the research landscape",
                "Limitations and open research questions",
              ][index - 1] ?? "Research context"),
        url: `https://example.invalid/synthetic-paper-${index}`,
        authors: ["Synthetic research fixture"],
        publishedAt: "2026-01-01",
        sourceType: index === 1 ? "Synthetic review" : "Synthetic research paper",
        excerpt:
          "This is a synthetic source for trying the interface. It demonstrates where a relevant passage, study conditions and limitations would appear. It is not a real scientific finding.",
        relevance:
          index === 1
            ? "Start here for context and terminology."
            : "Read this to inspect assumptions and evidence gaps.",
        metadata: { synthetic: true, contentTruncated: false },
        queryIds: [query.id],
      },
    ];
    return sources;
  }
  async synthesise(
    input: TaskInput,
    sources: Source[],
    scenario: string,
    signal: AbortSignal,
    emit: (markdown: string, key?: string) => Promise<void>,
    modelOperation?: ModelOperation,
  ): Promise<void> {
    // Synthetic writing still goes through the model ledger entry, with no charge.
    if (modelOperation)
      return modelOperation("model", RESEARCH_BUDGET.modelMicros, () =>
        this.write(input, sources, scenario, signal, emit),
      );
    return this.write(input, sources, scenario, signal, emit);
  }
  private async write(
    input: TaskInput,
    sources: Source[],
    scenario: string,
    signal: AbortSignal,
    emit: (markdown: string, key?: string) => Promise<void>,
  ): Promise<void> {
    if (scenario === "invalid-report") {
      await emit("An unchecked claim [1](https://example.invalid/not-a-source).");
      return;
    }
    const cite = (index: number) => `[${index + 1}](${sources[index]?.url ?? sources[0]?.url})`;
    const report =
      input.kind === "compare"
        ? `## The short answer\n\nA useful comparison of **${input.alternatives[0]}** and **${input.alternatives[1]}** needs evidence collected under comparable conditions. This simulated brief demonstrates that structure; it does not establish which alternative performs better. ${cite(0)} ${cite(1)}\n\n## Where to look closely\n\n| Dimension | ${input.alternatives[0]} | ${input.alternatives[1]} |\n| --- | --- | --- |\n| Evidence context | Check study conditions ${cite(0)} | Check study conditions ${cite(1)} |\n| Comparability | Match the use case and measurement method | Match the same use case and method |\n| Remaining gaps | Not measured in this simulation | Not measured in this simulation |\n\n## What the evidence cannot tell us\n\nThese fixture sources cannot support a performance ranking. In a real report this section explains unequal coverage, conflicting findings and conditions that limit a comparison. ${cite(2)}\n\n## Read next\n\nStart with the source for each alternative, then inspect the limitations. Open a citation to see its context without losing your place.`
        : `## The short answer\n\nStart with a review that establishes the question's scope, then inspect primary studies and the conditions behind their findings. This simulated evidence brief shows how the research will be presented; it does not claim to answer the scientific question. ${cite(0)}\n\n## A useful reading path\n\n1. **Get the context.** Read the review for terminology, scope and the main research directions. ${cite(0)}\n2. **Inspect the limits.** Look for assumptions, conflicting evidence and what has not been measured. ${cite(1)}\n\n## What remains uncertain\n\nNo live literature search has run. The real research flow will distinguish supported findings from gaps and explain why each selected source matters.`;
    for (const [index, block] of report.split(/\n\n(?=## )/).entries()) {
      await delay(scenario === "slow-stream" ? 8000 : 250, undefined, { signal });
      await emit(block);
      if (scenario === "partial-report" && index === 0)
        throw error(
          "INVALID_REPORT",
          "Writing stopped. The unfinished draft is saved; start a new attempt.",
          502,
          true,
        );
    }
  }
}
