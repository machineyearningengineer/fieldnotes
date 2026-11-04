/** Evaluator smoke: real hosted research. One idempotent task per journey in this private directory. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
const option = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const kind = option("--kind") ?? "discover";
if (!["discover", "compare"].includes(kind)) throw new Error("Choose --kind discover or compare");
const origin = "https://fieldnotes-valyu.vercel.app";
const directory = resolve(option("--out-dir") ?? ".local/evaluator");
await mkdir(directory, { recursive: true, mode: 0o700 });
const save = (file, data) =>
  writeFile(join(directory, file), JSON.stringify(data, null, 2), { mode: 0o600 });
const load = async (file) => {
  try {
    return JSON.parse(await readFile(join(directory, file), "utf8"));
  } catch (cause) {
    if (cause.code === "ENOENT") return null;
    throw cause;
  }
};
let session = await load("session.json");
let login = "reused same evaluator session";
if (!session) {
  const path = option("--code-file");
  if (!path)
    throw new Error(
      "First run needs --code-file PATH containing the separately supplied access code",
    );
  const code = (await readFile(path, "utf8")).trim();
  const response = await fetch(origin + "/api/session", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("fieldnotes-session="))
    ?.split(";")[0];
  if (response.status !== 303 || !cookie) throw new Error("Evaluator login failed");
  session = { cookie, createdAt: new Date().toISOString() };
  await save("session.json", session);
  login = "created evaluator session";
}
const request = (path, init = {}) =>
  fetch(origin + path, {
    ...init,
    headers: { Cookie: session.cookie, Origin: origin, ...init.headers },
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
const recent = await request("/api/research/tasks");
if (recent.status !== 200)
  throw new Error(
    "Evaluator session is unavailable. Preserve this directory; use a new --out-dir for another session.",
  );
const health = await request("/api/research/health");
assert.equal(health.status, 200);
assert.equal((await health.json()).status, "ok");
// A real typed rejection, before admission: this must consume no research allocation.
const invalid = await request("/api/research/tasks", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
  body: JSON.stringify({ schemaVersion: 1, kind: "discover", question: "" }),
});
assert.equal(invalid.status, 400);
const failure = await invalid.json();
assert.equal(failure.code, "INVALID_INPUT");
assert.equal(failure.version, 1);
assert.equal(typeof failure.traceId, "string");
const input = JSON.parse(
  await readFile(new URL(`../examples/${kind}-input.json`, import.meta.url), "utf8"),
);
let intent = await load(kind + "-request.json");
if (!intent) {
  intent = { input, key: randomUUID() };
  await save(kind + "-request.json", intent);
}
assert.deepEqual(
  intent.input,
  input,
  "Saved request differs; choose another output directory for a new paid evaluation.",
);
const submit = () =>
  request("/api/research/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": intent.key },
    body: JSON.stringify(input),
  });
const start = performance.now();
const response = await submit();
const accepted = await response.json();
if (response.status !== 202)
  throw new Error(`Submission failed (${response.status}): ${JSON.stringify(accepted)}`);
assert.equal(accepted.schemaVersion, 1);
const acceptanceMs = Math.round(performance.now() - start);
await save(kind + "-accepted.json", accepted);
console.log(
  JSON.stringify({
    stage: "accepted",
    kind,
    taskId: accepted.id,
    reference: accepted.traceId,
    acceptanceMs,
  }),
);
const replay = await submit();
assert.equal(replay.status, 202);
assert.equal((await replay.json()).id, accepted.id, "Idempotent replay created another task");
let task = accepted;
let etag;
const deadline = Date.now() + 330000;
while (!["succeeded", "failed"].includes(task.status)) {
  if (Date.now() > deadline)
    throw new Error(
      "Evaluation wait expired; task ID and idempotency key are retained. Do not submit a different key to retry.",
    );
  const read = await request(`/api/research/tasks/${task.id}`, {
    headers: etag ? { "If-None-Match": etag } : {},
  });
  if (read.status !== 304) {
    assert.equal(read.status, 200);
    const next = await read.json();
    assert.ok(next.revision >= task.revision);
    task = next;
    etag = read.headers.get("etag") ?? undefined;
  }
  if (!["succeeded", "failed"].includes(task.status))
    await new Promise((resolve) => setTimeout(resolve, 1500));
}
await save(kind + ".json", task);
if (task.status !== "succeeded")
  throw new Error(
    `Research failed: ${task.error?.code}; reference ${task.traceId}. Saved unfinished output retained.`,
  );
assert.ok(task.report && task.sources.length);
const links = [...task.report.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]);
assert.ok(links.length > 0);
assert.ok(
  links.every((url) => task.sources.some((source) => source.url === url)),
  "Report cites an unretained URL",
);
await writeFile(join(directory, kind + ".md"), task.report + "\n", { mode: 0o600 });
const proof = {
  observedAt: new Date().toISOString(),
  login,
  kind,
  taskId: task.id,
  reference: task.traceId,
  url: `${origin}/tasks/${task.id}`,
  status: task.status,
  acceptanceMs,
  timings: task.timings,
  citationCount: links.length,
  citationIdentity: "all links belong to retained sources; entailment requires review",
  validationFailure: { httpStatus: invalid.status, code: failure.code },
  idempotentReplaySameTask: true,
  usage: task.usage,
  output: join(directory, kind + ".json"),
};
await save(kind + "-proof.json", proof);
console.log(JSON.stringify(proof, null, 2));
