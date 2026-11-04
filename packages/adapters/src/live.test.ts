import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";
import { error, type Source } from "@valyu-research/contracts";
import type { ModelOperation } from "@valyu-research/research";
const mock = vi.hoisted(() => ({ generate: vi.fn(), verify: vi.fn() }));
beforeEach(() => {
  mock.generate.mockReset();
  mock.verify.mockReset();
});
vi.mock("@google/genai", async (original) => ({
  ...(await original<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContentStream: mock.generate, generateContent: mock.verify };
  },
}));
import { LiveProviders } from "./live.ts";
const operate: ModelOperation = async (_key, _allowance, call) => call();
const frame = {
  intent: "evidence",
  facets: [{ id: "f1", ask: "What evidence is reported?", required: true }],
};
const input = { schemaVersion: 1, kind: "discover", question: "Evidence?" } as const;
const source: Source = {
  id: "s-canonical-record-id",
  title: "Evidence",
  url: "https://example.org/paper",
  excerpt: "A retained supporting passage for the claim.",
  authors: [],
  publishedAt: null,
  sourceType: "paper",
  relevance: "Relevant",
  metadata: {},
  queryIds: ["q1"],
};
function provider(saved: { id: string; data: Record<string, unknown> }[] = []) {
  return new LiveProviders({
    apiKey: "synthetic-test-only",
    project: "fixture",
    model: "gemini-3.8-flash",
    location: "eu",
    saveArtifact: async (id, data) => {
      saved.push({ id, data });
    },
  });
}
it("distinguishes an uncharged HTTP rejection from an error inside an opened stream", async () => {
  const p = provider();
  mock.generate.mockRejectedValueOnce(new ApiError({ status: 503, message: "Unavailable" }));
  await expect(
    p.synthesise(input, [source], "success", new AbortController().signal, async () => {}, operate),
  ).rejects.toMatchObject({ retryable: true });
  expect(p.receipt("model")).toMatchObject({ complete: true, costMicros: 0 });
  mock.generate.mockResolvedValueOnce(
    (async function* () {
      yield* [];
      throw new ApiError({ status: 503, message: "Stream failed" });
    })(),
  );
  await expect(
    p.synthesise(input, [source], "success", new AbortController().signal, async () => {}, operate),
  ).rejects.toMatchObject({ retryable: false });
  expect(p.receipt("model")).toBeUndefined();
});
it("keeps streamed receipts current but saves the usage artifact only once", async () => {
  const saved: { id: string; data: Record<string, unknown> }[] = [];
  const p = provider(saved);
  const blocks: string[] = [];
  mock.verify.mockResolvedValueOnce({
    text: JSON.stringify({ verdicts: ["supported"], coverage: [["f1"]] }),
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
  });
  mock.generate.mockResolvedValueOnce(
    (async function* () {
      yield {
        text:
          JSON.stringify({ frame }) +
          "\n" +
          JSON.stringify({
            heading: "Evidence",
            claims: [
              { text: "Supported statement", sourceId: source.id, passageId: `${source.id}:p1` },
            ],
          }) +
          "\n",
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
      };
      yield { text: "", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 12 } };
      yield {
        text: "",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 15 },
      };
    })(),
  );
  await p.synthesise(
    input,
    [source],
    "success",
    new AbortController().signal,
    async (block) => {
      blocks.push(block);
    },
    operate,
  );
  expect(blocks).toHaveLength(1);
  expect(saved.filter(({ id }) => id === "model-usage")).toHaveLength(1);
  expect(saved.find(({ id }) => id === "claims-1")?.data.evidence).toEqual([
    { sourceId: source.id, quote: source.excerpt, claim: "Supported statement" },
  ]);
  expect(blocks[0]).toContain("[1](https://example.org/paper)");
  expect(p.receipt("model")).toMatchObject({ complete: true });
  expect(p.timings().modelChunkCount).toBe(3);
});

it("withholds a partly supported mixed claim and never publishes while its independent check is pending", async () => {
  const p = provider();
  const blocks: string[] = [];
  let release!: (value: unknown) => void;
  let started!: () => void;
  const checking = new Promise<void>((resolve) => {
    started = resolve;
  });
  mock.verify.mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  mock.generate.mockResolvedValueOnce(
    (async function* () {
      yield {
        text:
          JSON.stringify({ frame }) +
          "\n" +
          JSON.stringify({
            heading: "Conditions",
            claims: [
              {
                text: "Mild rates are recommended. Separately, LFP cooling slowed degradation.",
                sourceId: source.id,
                passageId: `${source.id}:p1`,
              },
              {
                text: "A retained supporting passage for the claim.",
                sourceId: source.id,
                passageId: `${source.id}:p1`,
              },
            ],
          }) +
          "\n",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 },
      };
    })(),
  );
  const task = p.synthesise(
    input,
    [source],
    "success",
    new AbortController().signal,
    async (block) => {
      blocks.push(block);
    },
    operate,
  );
  await checking;
  expect(blocks).toEqual([]);
  expect(p.receipt("model")?.complete).toBe(true);
  release({
    text: JSON.stringify({ verdicts: ["partial", "supported"], coverage: [[], ["f1"]] }),
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
  });
  await task;
  expect(blocks.join("\n")).not.toContain("LFP cooling");
  expect(blocks.join("\n")).toContain("A retained supporting passage");
  expect(blocks.join("\n")).toContain("1 draft claim was withheld");
});

it("shows a supported non-answer only as labelled related evidence, and withholds it once an answer exists", async () => {
  const check = (coverage: string[]) => ({
    text: JSON.stringify({ verdicts: ["supported"], coverage: [coverage] }),
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
  });
  const outcomes: string[] = [];
  const run = async () => {
    const blocks: string[] = [];
    const written = await provider().synthesise(
      input,
      [source],
      "success",
      new AbortController().signal,
      async (block) => {
        blocks.push(block);
      },
      operate,
    );
    outcomes.push(written.outcome);
    return blocks.join("\n\n");
  };
  mock.verify.mockResolvedValueOnce({
    ...check([]),
    text: JSON.stringify({ verdicts: ["supported", "partial"], coverage: [[], []] }),
  });
  mock.generate.mockResolvedValueOnce(
    (async function* () {
      const claim = (text: string) => ({ text, sourceId: source.id, passageId: `${source.id}:p1` });
      yield {
        text: [
          JSON.stringify({ frame }),
          JSON.stringify({
            heading: "Background",
            claims: [claim("Background finding."), claim("Unsupported extension.")],
          }),
          "",
        ].join("\n"),
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 },
      };
    })(),
  );
  const unanswered = await run();
  expect(unanswered).not.toContain("Unsupported extension");
  expect(unanswered.indexOf("## Not directly answered")).toBe(0);
  expect(unanswered).toContain("## Related evidence\n\n### Background");
  expect(unanswered).toContain("Background finding\\. [1](https://example.org/paper)");
  expect(unanswered).toContain("## Unresolved");

  mock.verify.mockResolvedValueOnce(check([])).mockResolvedValueOnce(check(["f1"]));
  mock.generate.mockResolvedValueOnce(sections("Background", "Answer"));
  const answered = await run();
  expect(answered).not.toContain("Background finding");
  expect(answered).not.toContain("Not directly answered");
  expect(answered).toContain("Answer finding");
  expect(answered).toContain("1 draft claim was withheld");
  expect(outcomes).toEqual(["unanswered", "answered"]);
});

it("cannot promote an ordinary web article into a research finding through a model verdict", async () => {
  const p = provider();
  const web = { ...source, sourceType: "website", metadata: { providerSource: "web" } };
  mock.verify.mockResolvedValue({
    text: JSON.stringify({ verdicts: ["supported"], coverage: [["f1"]] }),
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
  });
  mock.generate.mockResolvedValueOnce(
    (async function* () {
      yield {
        text:
          JSON.stringify({ frame: { ...frame, intent: "discover" } }) +
          "\n" +
          JSON.stringify({
            heading: "Claim",
            claims: [
              {
                text: "Unqualified web-source performance claim.",
                sourceId: web.id,
                passageId: `${web.id}:p1`,
              },
            ],
          }) +
          "\n",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
      };
    })(),
  );
  const blocks: string[] = [];
  await expect(
    p.synthesise(
      input,
      [web],
      "success",
      new AbortController().signal,
      async (block) => {
        blocks.push(block);
      },
      operate,
    ),
  ).rejects.toMatchObject({ code: "NO_EVIDENCE" });
  expect(blocks).toEqual([]);
  expect(mock.verify).not.toHaveBeenCalled();
});

const verdict = {
  text: JSON.stringify({ verdicts: ["supported"], coverage: [["f1"]] }),
  candidates: [{ finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
};
const sections = (...headings: string[]) =>
  (async function* () {
    const section = (heading: string) =>
      JSON.stringify({
        heading,
        claims: [
          { text: `${heading} finding.`, sourceId: source.id, passageId: `${source.id}:p1` },
        ],
      });
    yield {
      text: [JSON.stringify({ frame }), ...headings.map(section), ""].join("\n"),
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 },
    };
  })();

it("checks a later section while an earlier check is pending but publishes in model order", async () => {
  const p = provider();
  const blocks: string[] = [];
  const pending: ((value: unknown) => void)[] = [];
  mock.verify.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  mock.generate.mockResolvedValueOnce(sections("First", "Second"));
  const task = p.synthesise(
    input,
    [source],
    "success",
    new AbortController().signal,
    async (block) => {
      blocks.push(block);
    },
    operate,
  );
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]!(verdict);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(blocks).toEqual([]);
  pending[0]!(verdict);
  await task;
  expect(blocks[0]).toContain("First finding");
  expect(blocks[1]).toContain("Second finding");
});

it("waits for a running check when overlapping reservations would exceed the task allowance", async () => {
  const p = provider();
  const blocks: string[] = [];
  let inFlight = 0;
  const reserved: string[] = [];
  // Headroom for one check at a time, as in a recovered task holding uncertain reservations.
  const tight: ModelOperation = async (key, _allowance, call) => {
    if (key === "model") return call();
    if (inFlight) throw error("BUDGET_EXCEEDED", "No headroom for another reservation.", 422);
    reserved.push(key);
    inFlight++;
    try {
      return await call();
    } finally {
      inFlight--;
    }
  };
  mock.verify.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return verdict;
  });
  mock.generate.mockResolvedValueOnce(sections("First", "Second", "Third"));
  await p.synthesise(
    input,
    [source],
    "success",
    new AbortController().signal,
    async (block) => {
      blocks.push(block);
    },
    tight,
  );
  expect(blocks).toHaveLength(3);
  // Serial fallback keeps section order, so a later section cannot take an earlier one's headroom.
  expect(reserved).toEqual(["support-1", "support-2", "support-3"]);
});

it("never reserves a queued check after an earlier check fails", async () => {
  const p = provider();
  const reserved: string[] = [];
  const counting: ModelOperation = async (key, _allowance, call) => {
    if (key !== "model") reserved.push(key);
    return call();
  };
  mock.verify
    .mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("Checker failed");
    })
    .mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return verdict;
    });
  mock.generate.mockResolvedValueOnce(sections("First", "Second", "Third"));
  await expect(
    p.synthesise(
      input,
      [source],
      "success",
      new AbortController().signal,
      async () => {},
      counting,
    ),
  ).rejects.toBeDefined();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(reserved).toEqual(["support-1", "support-2"]);
});

it("withholds a malformed section after the plan instead of losing the checked answer", async () => {
  const blocks: string[] = [];
  mock.verify.mockResolvedValueOnce(verdict);
  mock.generate.mockResolvedValueOnce(
    (async function* () {
      const answer = {
        heading: "Answer",
        claims: [{ text: "Answer finding.", sourceId: source.id, passageId: `${source.id}:p1` }],
      };
      yield {
        text: [
          JSON.stringify({ frame }),
          '{"heading":"Broken","claims":[{"passageId":"x": "p2"}]}',
          JSON.stringify(answer),
          "",
        ].join("\n"),
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 },
      };
    })(),
  );
  await provider().synthesise(
    input,
    [source],
    "success",
    new AbortController().signal,
    async (block) => {
      blocks.push(block);
    },
    operate,
  );
  expect(blocks.join("\n\n")).toContain("Answer finding");
  expect(blocks.join("\n\n")).toContain(
    "1 draft section was withheld because the model returned it malformed.",
  );
});

it("replays a saved draft without a model call and reuses a saved check", async () => {
  const blocks: [string | undefined, string][] = [];
  const line = (heading: string) =>
    JSON.stringify({
      heading,
      claims: [{ text: `${heading} finding.`, sourceId: source.id, passageId: `${source.id}:p1` }],
    });
  mock.verify.mockResolvedValueOnce(verdict);
  await provider().synthesise(
    input,
    [source],
    "success",
    new AbortController().signal,
    async (block, key) => {
      blocks.push([key, block]);
    },
    operate,
    {
      draft: [JSON.stringify({ frame }), line("First"), line("Second")],
      checks: { "support-1": { verdicts: ["supported"], coverage: [["f1"]] } },
      saveDraft: async () => {},
      saveCheck: async () => {},
    },
  );
  expect(mock.generate).not.toHaveBeenCalled();
  expect(mock.verify).toHaveBeenCalledTimes(1);
  expect(blocks.map(([key]) => key)).toEqual(["section-1", "section-2"]);
});
