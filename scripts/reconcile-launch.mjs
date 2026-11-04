/** Release only unused admission allocation after all launch tasks are terminal. Uncertain step reservations remain held. */
import { spawnSync } from "node:child_process";
import { RESEARCH_BUDGET, usageExposure } from "../packages/research/src/index.ts";
const limit = RESEARCH_BUDGET.demoLifetimeMicros;
const project = "fieldnotes-valyu-20261102";
const auth = spawnSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" });
if (auth.status !== 0) throw new Error("Google CLI sign-in is unavailable");
const headers = {
  Authorization: `Bearer ${auth.stdout.trim()}`,
  "Content-Type": "application/json",
};
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
// Read the ledger first. Its updateTime precondition detects any concurrent acceptance before commit.
const ledgerResponse = await fetch(base + "/limits/launch", { headers });
if (!ledgerResponse.ok) throw new Error("Launch ledger unavailable");
const ledger = await ledgerResponse.json();
// Firestore also splits pages by response size, so follow page tokens up to a fixed bound.
const docs = [];
let pageToken = "";
for (let page = 0; ; page++) {
  if (page >= 50) throw new Error("Inventory exceeds this bounded launch reconciliation");
  const recordsResponse = await fetch(
    base + "/tasks?pageSize=100" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""),
    { headers },
  );
  if (!recordsResponse.ok) throw new Error("Task inventory unavailable");
  const records = await recordsResponse.json();
  docs.push(...(records.documents ?? []));
  if (!records.nextPageToken) break;
  pageToken = records.nextPageToken;
}
if (Number(ledger.fields.taskCount.integerValue) !== docs.length)
  throw new Error("Task inventory changed or does not match the admission ledger");
let exposure = 0;
let operations = 0;
for (const doc of docs) {
  const snapshot = doc.fields.snapshot.mapValue.fields;
  if (!["succeeded", "failed"].includes(snapshot.status.stringValue))
    throw new Error("Research is still active; no reconciliation applied");
  for (const item of snapshot.usage.arrayValue.values ?? []) {
    const value = item.mapValue.fields;
    const reserved = Number(value.reservedMicros.integerValue);
    const measured = "integerValue" in value.costMicros ? Number(value.costMicros.integerValue) : 0;
    if (
      !Number.isSafeInteger(reserved) ||
      reserved < 0 ||
      !Number.isSafeInteger(measured) ||
      measured < 0
    )
      throw new Error("Invalid usage amount");
    exposure += usageExposure([
      {
        state: value.state.stringValue,
        reservedMicros: reserved,
        costMicros: "integerValue" in value.costMicros ? measured : null,
      },
    ]);
    operations++;
  }
}
const before = Number(ledger.fields.reservedMicros.integerValue);
if (
  !Number.isSafeInteger(before) ||
  !Number.isSafeInteger(exposure) ||
  exposure > before ||
  before > limit
)
  throw new Error("The conservative exposure cannot be safely reduced");
const proof = {
  project,
  taskCount: docs.length,
  operations,
  beforeMicros: before,
  retainedMicros: exposure,
  releasedUnusedMicros: before - exposure,
  lifetimeLimitMicros: limit,
  availableTaskSlots: Math.floor((limit - exposure) / 100_000),
  basis:
    "Settled provider receipts use recorded costs (synthesis remains token-estimated); unknown calls retain full reservations or larger known costs",
  applied: false,
};
if (process.argv.includes("--apply")) {
  const response = await fetch(
    `${base}/limits/launch?updateMask.fieldPaths=reservedMicros&currentDocument.updateTime=${encodeURIComponent(ledger.updateTime)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields: { reservedMicros: { integerValue: String(exposure) } } }),
    },
  );
  if (!response.ok) throw new Error("Ledger changed concurrently or update failed; no blind retry");
  proof.applied = true;
}
console.log(JSON.stringify(proof, null, 2));
