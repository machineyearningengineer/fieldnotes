/** Read a task, its correlated logs and trace using the operator's existing Google CLI login. */
import { spawnSync } from "node:child_process";
const selector = process.argv[2];
const includeArtifacts = process.argv.includes("--artifacts");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
let taskId = selector;
if (selector?.startsWith("https://") || selector?.startsWith("http://")) {
  const url = new URL(selector);
  taskId = url.pathname.match(/^\/tasks\/([^/]+)\/?$/)?.[1];
}
const byId = !!taskId && uuid.test(taskId);
if (!selector || (!byId && !/^[a-f0-9]{12,32}$/i.test(selector)))
  throw new Error(
    "Usage: node scripts/inspect-cloud-task.mjs <task URL | task ID | reference> [--artifacts]",
  );
const prefix = selector.toLowerCase();
const project = "fieldnotes-valyu-20261102";
const auth = spawnSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" });
if (auth.status !== 0) throw new Error("Google CLI sign-in is unavailable");
const headers = {
  Authorization: `Bearer ${auth.stdout.trim()}`,
  "Content-Type": "application/json",
};
const root = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const response = await fetch(
  byId ? `${root}/tasks/${taskId.toLowerCase()}` : `${root}:runQuery`,
  byId
    ? { headers, signal: AbortSignal.timeout(15000) }
    : {
        method: "POST",
        headers,
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "tasks" }],
            where: {
              compositeFilter: {
                op: "AND",
                filters: [
                  {
                    fieldFilter: {
                      field: { fieldPath: "snapshot.traceId" },
                      op: "GREATER_THAN_OR_EQUAL",
                      value: { stringValue: prefix.padEnd(32, "0") },
                    },
                  },
                  {
                    fieldFilter: {
                      field: { fieldPath: "snapshot.traceId" },
                      op: "LESS_THAN_OR_EQUAL",
                      value: { stringValue: prefix.padEnd(32, "f") },
                    },
                  },
                ],
              },
            },
            limit: 2,
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
);
if (!response.ok) throw new Error("Task inspection failed " + response.status);
const body = await response.json();
const docs = byId ? [{ document: body }] : body.filter((row) => row.document);
if (docs.length !== 1)
  throw new Error(
    docs.length ? "Ambiguous reference; use the task ID or full reference" : "Task not found",
  );
function decode(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decode);
  if ("mapValue" in value)
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]),
    );
  throw new Error("Unsupported stored value");
}
const record = decode({ mapValue: { fields: docs[0].document.fields } });
const task = record.snapshot;
const reference = task.traceId;
const stages = ["queued", "searching", "writing", "checking"];
const stageDurationsMs = {};
for (let i = 0; i < stages.length; i++) {
  const start = task.events.find((event) => event.stage === stages[i]);
  if (!start) continue;
  const next = task.events.find(
    (event) => Date.parse(event.at) > Date.parse(start.at) && event.stage !== start.stage,
  );
  if (next) stageDurationsMs[stages[i]] = Date.parse(next.at) - Date.parse(start.at);
}
const logResult = spawnSync(
  "gcloud",
  [
    "logging",
    "read",
    `jsonPayload.reference="${reference}"`,
    "--project=" + project,
    "--limit=100",
    "--format=json",
  ],
  { encoding: "utf8" },
);
const logs = logResult.status === 0 ? JSON.parse(logResult.stdout) : null;
let artifacts;
if (includeArtifacts) {
  const result = await fetch(`${root}/tasks/${task.id}/artifacts?pageSize=100`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new Error("Artifact inspection failed " + result.status);
  const page = await result.json();
  artifacts = {
    documents: (page.documents ?? []).map((doc) => ({
      id: doc.name.split("/").at(-1),
      ...decode({ mapValue: { fields: doc.fields } }),
    })),
    truncated: !!page.nextPageToken,
  };
}
const trace = await fetch(
  `https://cloudtrace.googleapis.com/v1/projects/${project}/traces/${reference}`,
  { headers, signal: AbortSignal.timeout(15000) },
);
console.log(
  JSON.stringify(
    {
      version: 1,
      project,
      taskId: task.id,
      reference,
      input: task.input,
      queries: task.queries,
      sources: task.sources,
      report: task.report,
      reportDraft: task.reportDraft,
      simulation: task.simulation,
      status: task.status,
      stage: task.stage,
      revision: task.revision,
      events: task.events,
      usage: task.usage,
      timings: task.timings,
      stageDurationsMs,
      error: task.error,
      artifacts,
      logs: logs?.map((row) => ({
        timestamp: row.timestamp,
        serviceRevision: row.resource?.labels?.revision_name,
        ...row.jsonPayload,
      })) ?? { unavailable: true },
      trace: trace.ok ? await trace.json() : { unavailable: true, status: trace.status },
    },
    null,
    2,
  ),
);
