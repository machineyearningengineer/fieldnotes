/** Local emulator verification. Creates an isolated emulator project; no provider calls. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  FixtureProviders,
  FirestoreTaskStore,
  localDatabase,
} from "../packages/adapters/src/index.ts";
import { createRecord, ResearchService } from "../packages/research/src/index.ts";
import type { TaskInput } from "../packages/contracts/src/index.ts";

const runtime = JSON.parse(
  await readFile(new URL("../.local/runtime.json", import.meta.url), "utf8"),
);
process.env.FIRESTORE_EMULATOR_HOST = runtime.firestore;
const db = localDatabase();
const project = `valyu-checks-${randomUUID().slice(0, 8)}`;
db.settings({ projectId: project });
const store = new FirestoreTaskStore(db);
const input: TaskInput = {
  schemaVersion: 1,
  kind: "discover",
  question: "Synthetic recovery verification",
};
const owner = "verification";
const accept = async () => store.accept(createRecord(input, owner, "success"), randomUUID());
const results: Record<string, boolean> = {};
const deadline = setTimeout(() => {
  console.error("Local verification exceeded 30 seconds");
  process.exit(1);
}, 30_000);
try {
  const key = randomUUID();
  const submissions = await Promise.all([
    store.accept(createRecord(input, owner, "success"), key),
    store.accept(createRecord(input, owner, "success"), key),
  ]);
  assert.equal(submissions[0]!.id, submissions[1]!.id);
  const id = submissions[0]!.id;
  const claims = await Promise.all([store.claim(id, "a"), store.claim(id, "b")]);
  assert.equal(claims.filter(Boolean).length, 1);
  const first = claims.find(Boolean)!;
  await db.collection("tasks").doc(id).update({ leaseUntilMs: 0 });
  const replacement = await store.claim(id, "replacement");
  assert.ok(replacement && replacement.epoch > first.epoch);
  assert.equal(await store.change(id, first.epoch, (record) => record), null);
  await store.change(id, replacement.epoch, (record) => ({
    ...record,
    snapshot: {
      ...record.snapshot,
      status: "failed",
      stage: "failed",
      revision: record.snapshot.revision + 1,
      error: {
        code: "INTERNAL",
        message: "Verification finished",
        retryable: false,
        traceId: record.snapshot.traceId,
      },
    },
  }));
  assert.equal(await store.claim(id, "terminal-replay"), null);
  results.idempotencyAndFencing = true;

  const normal = await accept();
  const service = new ResearchService(store, new FixtureProviders());
  await Promise.all([service.run(normal.id, "delivery-a"), service.run(normal.id, "delivery-b")]);
  const completed = (await store.get(normal.id))!;
  assert.equal(completed.snapshot.status, "succeeded");
  assert.equal(completed.attempts, 1);
  assert.equal(
    completed.snapshot.reportDraft!.blocks.map((block) => block.markdown).join("\n\n"),
    completed.snapshot.report,
  );
  const revision = completed.snapshot.revision;
  await service.run(normal.id, "replayed-delivery");
  assert.equal((await store.get(normal.id))!.snapshot.revision, revision);
  results.duplicateDeliverySingleFinal = true;

  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved = () => {};
  const firstBlock = new Promise<void>((resolve) => {
    saved = resolve;
  });
  class InterruptedProvider extends FixtureProviders {
    override async synthesise(...args: Parameters<FixtureProviders["synthesise"]>) {
      const [, sources, , , emit, operate] = args;
      // Like a real writer, the model call is a ledger operation that an interruption leaves reserved.
      await operate!("model", 60_000, async () => {
        await emit(`## Saved draft\n\nSynthetic evidence [1](${sources[0]!.url}).`);
        saved();
        await gate;
        await emit("## Stale continuation\n\nThis write must be fenced out.");
      });
    }
  }
  const interrupted = await accept();
  const oldRun = new ResearchService(store, new InterruptedProvider()).run(
    interrupted.id,
    "old-writer",
  );
  try {
    await firstBlock;
    const draft = (await store.get(interrupted.id))!;
    assert.equal(draft.snapshot.reportDraft!.blocks.length, 1);
    await db.collection("tasks").doc(interrupted.id).update({ leaseUntilMs: 0 });
    await service.run(interrupted.id, "recovery-writer");
    release();
    await oldRun;
    const recovered = (await store.get(interrupted.id))!;
    assert.equal(recovered.snapshot.status, "failed");
    assert.equal(recovered.snapshot.report, null);
    assert.deepEqual(recovered.snapshot.reportDraft, draft.snapshot.reportDraft);
    assert.ok(
      recovered.snapshot.usage.some(
        (entry) => entry.state === "unknown" && entry.costMicros === null,
      ),
    );
    results.interruptedDraftRetainedAndStaleWriterRejected = true;
  } finally {
    release();
  }
  console.log(JSON.stringify({ mode: "local-simulation", project, results, paidCalls: 0 }));
} finally {
  clearTimeout(deadline);
  await db.terminate();
}
