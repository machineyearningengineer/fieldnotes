import { describe, expect, it, vi } from "vitest";
import {
  ResearchService,
  RESEARCH_BUDGET,
  type TaskStore,
  type ResearchProviders,
  appendReportBlock,
  createRecord,
  reportFromBlocks,
  reserve,
  validateDraftLinks,
  validateReport,
  usageExposure,
} from "./index.ts";
import { Effect } from "effect";
import { decodeSnapshot, newerSnapshot, type Source } from "@valyu-research/contracts";

describe("research limits", () => {
  it("rejects unpriced live research before creating a task or reserving money", async () => {
    const accept = vi.fn();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(RESEARCH_BUDGET.priceReviewAt));
    try {
      const service = new ResearchService(
        { accept } as unknown as TaskStore,
        { simulation: false } as ResearchProviders,
      );
      await expect(
        Effect.runPromise(
          service.submit(
            { schemaVersion: 1, kind: "discover", question: "A question" },
            "owner",
            "request-key",
          ),
        ),
      ).rejects.toThrow();
      expect(accept).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it("rejects any reservation that could exceed a task budget", () => {
    expect(reserve(70_000, 30_000, 100_000)).toBe(100_000);
    for (const amount of [30_001, -1, 0.5, Number.NaN]) {
      expect(() => reserve(70_000, amount, 100_000)).toThrow();
    }
    expect(
      usageExposure([
        { state: "settled", reservedMicros: 10000, costMicros: 100 },
        { state: "unknown", reservedMicros: 60000, costMicros: 1000 },
        { state: "reserved", reservedMicros: 9000, costMicros: null },
      ]),
    ).toBe(69100);
  });
  it("rejects a report citing evidence the task did not retrieve", () => {
    const source = { url: "https://example.invalid/known" } as Source;
    expect(() =>
      validateReport("Supported [1](https://example.invalid/known).", [source]),
    ).not.toThrow();
    expect(() =>
      validateReport("Invented [1](https://example.invalid/unknown).", [source]),
    ).toThrow();
    expect(() => validateReport("A claim without a source.", [source])).toThrow();
  });
});

describe("durable task snapshots", () => {
  const input = { schemaVersion: 1, kind: "discover", question: "Synthetic question" } as const;
  it("rejects malformed snapshots and keeps the existing object for duplicate or stale frames", () => {
    const current = createRecord(input, "local-researcher", "success").snapshot;
    expect(decodeSnapshot(current.id, current).revision).toBe(1);
    expect(() => decodeSnapshot("other", current)).toThrow();
    expect(() => decodeSnapshot(current.id, { ...current, sources: "invalid" })).toThrow();
    expect(newerSnapshot(current, { ...current })).toBe(current);
    expect(newerSnapshot({ ...current, revision: 2 }, current).revision).toBe(2);
  });
  it("appends stable complete blocks while preserving prior draft and rejecting unknown citations", () => {
    const first = createRecord(input, "local-researcher", "success");
    const second = appendReportBlock(first, "## First\n\nA paragraph.");
    const third = appendReportBlock(second, "## Second\n\nAnother paragraph.");
    expect(first.snapshot.reportDraft).toBeNull();
    expect(second.snapshot.reportDraft?.blocks).toHaveLength(1);
    expect(third.snapshot.reportDraft?.blocks[0]).toBe(second.snapshot.reportDraft?.blocks[0]);
    expect(third.snapshot.revision).toBe(first.snapshot.revision + 2);
    expect(reportFromBlocks(third.snapshot.reportDraft?.blocks ?? [])).toBe(
      "## First\n\nA paragraph.\n\n## Second\n\nAnother paragraph.",
    );
    expect(() => validateDraftLinks("[wrong](https://example.invalid/other)", [])).toThrow();
  });
});
