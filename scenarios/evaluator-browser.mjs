/** Real hosted reader checks using the CLI evaluator's own session. No new hosted research. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
const directory = resolve(process.argv[2] ?? ".local/evaluator");
const session = JSON.parse(await readFile(join(directory, "session.json"), "utf8"));
const value = session.cookie.slice("fieldnotes-session=".length);
assert.ok(session.cookie.startsWith("fieldnotes-session="));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const proof = {
  observedAt: new Date().toISOString(),
  hosted: [],
  localFailure: null,
  newHostedResearchCalls: 0,
};
await mkdir(join(directory, "screenshots"), { recursive: true });
try {
  for (const [kind, width, height] of [
    ["discover", 1360, 1000],
    ["compare", 390, 844],
  ]) {
    const task = JSON.parse(await readFile(join(directory, kind + ".json"), "utf8"));
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    context.setDefaultTimeout(15000);
    await context.addCookies([
      {
        name: "fieldnotes-session",
        value,
        domain: "fieldnotes-valyu.vercel.app",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    let reads = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === `/api/research/tasks/${task.id}`) reads++;
    });
    await page.goto(`https://fieldnotes-valyu.vercel.app/tasks/${task.id}`);
    await page.getByRole("heading", { level: 1, name: task.input.question, exact: true }).waitFor();
    const baseline = reads;
    const citation = page.getByRole("link", { name: /^Open source \d+$/ }).first();
    const original = await citation.getAttribute("href");
    await citation.click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("heading", { name: "Extracted text", exact: true }).waitFor();
    assert.equal(
      await panel
        .getByRole("link", { name: "Open original source", exact: true })
        .getAttribute("href"),
      original,
    );
    await page.screenshot({ path: join(directory, "screenshots", kind + ".png") });
    await panel.getByRole("button", { name: "Close source", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    assert.equal(reads - baseline, 0, "Citation inspection made a redundant task read");
    await page.reload();
    await page.getByRole("heading", { level: 1, name: task.input.question, exact: true }).waitFor();
    proof.hosted.push({
      kind,
      taskId: task.id,
      citationDrawer: true,
      originalLinkMatches: true,
      sourceInspectionAdditionalReads: 0,
      refresh: true,
    });
    await context.close();
  }
  // Deliberate worker failure is local and labelled synthetic; production has no fault-injection switch.
  const runtimePath = process.env.LOCAL_RUNTIME_FILE;
  if (!runtimePath)
    throw new Error(
      "Set LOCAL_RUNTIME_FILE to the running local demo's runtime.json to demonstrate durable worker failure",
    );
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  assert.equal(runtime.mode, "local");
  for (const endpoint of [runtime.api, runtime.web])
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname));
  const response = await fetch(runtime.api + "/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      "X-Demo-Scenario": "invalid-report",
    },
    body: JSON.stringify({
      schemaVersion: 1,
      kind: "discover",
      question: "Failure recovery demonstration (synthetic)",
    }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 202);
  let failed = await response.json();
  const until = Date.now() + 15000;
  while (!["succeeded", "failed"].includes(failed.status)) {
    assert.ok(Date.now() < until);
    await new Promise((resolve) => setTimeout(resolve, 250));
    failed = await (await fetch(runtime.api + "/tasks/" + failed.id)).json();
  }
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "INVALID_REPORT");
  const local = await browser.newContext({
    viewport: { width: 1000, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await local.newPage();
  await page.goto(runtime.web + "/tasks/" + failed.id);
  await page.getByRole("alert").getByText("Error: INVALID_REPORT", { exact: false }).waitFor();
  await page.screenshot({ path: join(directory, "screenshots", "local-failure.png") });
  await page.reload();
  await page.getByRole("alert").getByText("Error: INVALID_REPORT", { exact: false }).waitFor();
  proof.localFailure = {
    simulation: failed.simulation,
    taskId: failed.id,
    reference: failed.traceId,
    status: failed.status,
    code: failed.error.code,
    visibleAfterRefresh: true,
  };
  await writeFile(join(directory, "local-failure.json"), JSON.stringify(failed, null, 2), {
    mode: 0o600,
  });
  const hide = await fetch(runtime.api + "/tasks/" + failed.id + "/recent", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visible: false }),
  });
  assert.equal(hide.status, 204);
  await local.close();
  await writeFile(join(directory, "browser-proof.json"), JSON.stringify(proof, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser.close();
}
