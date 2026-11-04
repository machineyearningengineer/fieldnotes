/**
 * Offline gate for the passage checker: runs the reviewed cases in evaluation/claim-support.json
 * through the real checker and exits non-zero on any mismatch. One model call per group, a hard
 * spending cap, no task, search, generation, admission or Firestore write.
 * Run before changing checker or synthesis prompts, model or thinking settings:
 *   node scripts/evaluate-claims.ts --run
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { LiveProviders } from "../packages/adapters/src/live.ts";
import type { AnswerFrame } from "../packages/research/src/grounding.ts";
import type { CostReceipt } from "../packages/research/src/index.ts";

type Case = {
  id: string;
  sourceId: string;
  passage: string;
  claim: string;
  expect: "supported" | "withheld";
};
type Group = {
  name: string;
  question: string;
  frame: AnswerFrame;
  sources: {
    id: string;
    title: string;
    url: string;
    publishedAt: string | null;
    sourceType: string;
  }[];
  cases: Case[];
};
if (!process.argv.includes("--run"))
  throw new Error(
    "Use --run. This makes one paid checker call per group, capped at USD0.05 in total.",
  );
const MAX_TOTAL_MICROS = 50_000;
const set = JSON.parse(
  await readFile(new URL("../evaluation/claim-support.json", import.meta.url), "utf8"),
) as {
  groups: Group[];
};
const token = spawnSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" });
if (token.status !== 0 || !token.stdout.trim())
  throw new Error("Google CLI sign-in is unavailable");
const live = new LiveProviders({
  apiKey: "no-search-in-offline-evaluation",
  project: "fieldnotes-valyu-20261102",
  location: "eu",
  model: "gemini-3.8-flash",
  saveArtifact: async () => {},
  accessToken: token.stdout.trim(),
});
let reserved = 0;
let spent = 0;
const failures: string[] = [];
for (const group of set.groups) {
  const key = `support-${set.groups.indexOf(group) + 1}`;
  const result = await live.checkSupport(
    key,
    group.cases.map((item) => ({
      sourceId: item.sourceId,
      quote: item.passage,
      claim: item.claim,
    })),
    {
      frame: group.frame,
      input: { schemaVersion: 1, kind: "discover", question: group.question },
      sources: group.sources.map((source) => ({
        ...source,
        authors: [],
        excerpt: "",
        relevance: "",
        metadata: {},
        queryIds: [],
      })),
    },
    AbortSignal.timeout(90_000),
    async (_key, allowance, call) => {
      // Same reserve-before-request rule as the task ledger, against this run's own cap.
      if (spent + reserved + allowance > MAX_TOTAL_MICROS)
        throw new Error("Evaluation spending cap reached");
      reserved += allowance;
      try {
        return await call();
      } finally {
        const receipt: CostReceipt | undefined = live.receipt(key);
        reserved -= allowance;
        spent += receipt ? receipt.costMicros : allowance;
      }
    },
  );
  group.cases.forEach((item, index) => {
    const verdict = result.verdicts[index];
    const outcome = verdict === "supported" ? "supported" : "withheld";
    const pass = outcome === item.expect;
    if (!pass) failures.push(item.id);
    console.log(
      `${pass ? "pass" : "FAIL"}  ${group.name}/${item.id}: expected ${item.expect}, checker said ${verdict}`,
    );
  });
}
console.log(
  JSON.stringify({
    cases: set.groups.reduce((n, g) => n + g.cases.length, 0),
    failures,
    estimatedUSD: spent / 1e6,
  }),
);
if (failures.length) process.exit(1);
