import assert from "node:assert/strict";
import test from "node:test";
import {
  beginTask, completeTask, createTask, failTask, parseQuestion, publicTask,
} from "../src/task.ts";

test("question validation and bounded two-surface search plan", () => {
  assert.throws(() => parseQuestion("   "), /required/);
  assert.throws(() => parseQuestion("x".repeat(501)), /500/);
  const task = createTask("  How does CRISPR   treatment work?  ");
  assert.equal(task.question, "How does CRISPR treatment work?");
  assert.deepEqual(task.queries.map(({ searchType }) => searchType), ["proprietary", "web"]);
  assert.equal(task.queries.reduce((sum, query) => sum + query.maxNumResults, 0), 10);
  assert.equal(task.status, "queued");
  assert.equal(publicTask(task).report, undefined);
});

test("terminal result cannot be replaced by a duplicate delivery", () => {
  const running = beginTask(createTask("What evidence supports this treatment?"));
  const done = completeTask(running, {
    sources: [{ id: "s1", title: "Example", url: "https://example.org/paper", metadata: { journal: "Example Journal" } }],
    report: "Evidence is limited [1](https://example.org/paper).",
    costs: [{ service: "model", usd: 0.01, basis: "estimate", detail: "Test fixture" }],
  });
  assert.equal(done.status, "succeeded");
  assert.throws(() => completeTask(done, { sources: [], report: "replacement", costs: [] }), /Cannot complete/);
  assert.throws(() => failTask(done, "late failure"), /Cannot fail/);
});

test("failure is terminal and visible to the client", () => {
  const failed = failTask(beginTask(createTask("What is known?")), "Search timed out. Please try again.");
  assert.equal(publicTask(failed).error, "Search timed out. Please try again.");
  assert.equal(publicTask(failed).status, "failed");
  assert.throws(() => beginTask(failed), /Cannot start/);
});
