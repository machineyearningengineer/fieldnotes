/** Inspect a saved local task by its full support reference. No cloud credentials. */
import { readFile } from "node:fs/promises";
import { localDatabase } from "../packages/adapters/src/index.ts";
import { decodeSnapshot } from "../packages/contracts/src/index.ts";
const reference = process.argv[2];
if (!reference || !/^[a-f0-9]{32}$/.test(reference))
  throw new Error("Usage: node scripts/inspect-task.ts <full-32-character-reference>");
const runtime = JSON.parse(
  await readFile(new URL("../.local/runtime.json", import.meta.url), "utf8"),
);
if (runtime.mode !== "local") throw new Error("This inspector is local-only.");
process.env.FIRESTORE_EMULATOR_HOST = runtime.firestore;
const db = localDatabase();
try {
  const result = await db
    .collection("tasks")
    .where("snapshot.traceId", "==", reference)
    .limit(2)
    .get();
  if (result.size !== 1) throw new Error("The reference did not identify exactly one local task.");
  const record = result.docs[0]!.data();
  const task = decodeSnapshot(result.docs[0]!.id, record.snapshot);
  console.log(
    JSON.stringify(
      {
        version: 1,
        taskId: task.id,
        reference: task.traceId,
        status: task.status,
        stage: task.stage,
        revision: task.revision,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        error: task.error,
        events: task.events,
        usage: task.usage,
        timings: task.timings,
      },
      null,
      2,
    ),
  );
} finally {
  await db.terminate();
}
