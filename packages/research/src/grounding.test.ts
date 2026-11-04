import { mergeSources } from "./index.ts";
import { expect, it } from "vitest";
import {
  groundedSection,
  passagesForSources,
  numericAnchor,
  supportVerdicts,
  checkedCoverage,
  answerFrame,
  synthesisSources,
} from "./grounding.ts";
import { validateReport } from "./index.ts";
import type { Source } from "@valyu-research/contracts";
it("rejects a cited claim whose supporting passage was never retrieved", () => {
  const source = {
    id: "paper-1",
    url: "https://example.invalid/paper",
    excerpt: "The cells were evaluated at room temperature for one hundred cycles.",
  } as Source;
  const claim = {
    text: "The experiment evaluated cells at room temperature.",
    sourceId: "paper-1",
    passageId: passagesForSources([source])[0]!.id,
  };
  const section = { heading: "Study conditions", claims: [claim] };
  expect(groundedSection(section, [source]).markdown).toContain(
    "[1](https://example.invalid/paper)",
  );
  expect(groundedSection(section, [source]).evidence[0]!.quote).toBe(
    passagesForSources([source])[0]!.text,
  );
  const unsupported = {
    ...section,
    claims: [{ ...claim, passageId: "fabricated-passage" }],
  };
  expect(() =>
    validateReport("Unfounded performance claim [1](https://example.invalid/paper).", [source]),
  ).not.toThrow();
  expect(() => groundedSection(unsupported, [source])).toThrow(
    "invalid source or supporting passage",
  );
  expect(() =>
    groundedSection(
      { ...section, claims: [{ ...claim, text: "Uncited paragraph.\n\nOther paragraph." }] },
      [source],
    ),
  ).toThrow();
  expect(() =>
    groundedSection({ ...section, claims: [{ ...claim, sourceId: "unretrieved" }] }, [source]),
  ).toThrow();
  expect(
    numericAnchor(
      "Mild 0.5C operation. Separately, LFP was tested over 103 cycles at 2C.",
      "Mild 0.5C operation at ambient temperature is recommended.",
    ),
  ).toBe(false);
  expect(
    numericAnchor("The trial ran 1,000 cycles at 2C.", "At 2C the trial ran 1000 cycles."),
  ).toBe(true);
  expect(() => supportVerdicts({ verdicts: [true] }, 1)).toThrow();
  const frame = answerFrame({
    intent: "explain",
    facets: [{ id: "f1", ask: "How does the named system retrieve candidates?", required: true }],
  });
  expect(() => checkedCoverage({ coverage: [["invented-facet"]] }, 1, frame)).toThrow();
  expect(answerFrame({ ...frame, intent: "discover" }).intent).toBe("evidence");
  const paper = { ...source, sourceType: "paper", metadata: {} } as Source;
  const web = { ...paper, id: "web", sourceType: "website", metadata: { providerSource: "web" } };
  const compare = {
    schemaVersion: 1,
    kind: "compare",
    question: "Compare evidence",
    alternatives: ["A", "B"],
  } as const;
  const discover = {
    schemaVersion: 1,
    kind: "discover",
    question: "What does the evidence establish?",
  } as const;
  expect(
    synthesisSources({ ...compare, alternatives: [...compare.alternatives] }, [web, paper]),
  ).toEqual([paper]);
  expect(synthesisSources(discover, [web, paper], "evidence")).toEqual([paper]);
  expect(synthesisSources(discover, [web, paper], "explain")).toEqual([web, paper]);
  // A journal article found by web search is admitted through its DOI; a supplier page is not.
  const journal = {
    ...web,
    id: "journal",
    url: "https://www.frontiersin.org/journals/chemistry/articles/10.3389/fchem.2026.1/full",
  };
  const supplier = { ...web, id: "supplier", url: "https://example-battery.com/sodium-ion-vs-lfp" };
  expect(synthesisSources(discover, [journal, supplier], "evidence")).toEqual([journal]);
  // The same URL from the primary web search and the academic search keeps primary citation order
  // without losing its scholarly classification.
  const fromWeb = { ...web, id: "same", queryIds: ["q1"] };
  const fromAcademic = {
    ...paper,
    id: "same",
    metadata: { providerSource: "valyu/valyu-arxiv" },
    queryIds: ["q2"],
  };
  const [merged] = mergeSources([fromWeb], [fromAcademic], ["q1", "q2"]);
  expect(merged!.queryIds).toEqual(["q1", "q2"]);
  expect(
    synthesisSources({ ...compare, alternatives: [...compare.alternatives] }, [merged!]),
  ).toEqual([merged]);
});
