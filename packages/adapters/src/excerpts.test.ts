import { expect, it } from "vitest";
import { selectExcerpt } from "./excerpts.ts";
import { EXCERPT_BREAK, passagesForSources } from "@valyu-research/research/grounding";
import type { Source } from "@valyu-research/contracts";
it("retains a later mechanism instead of only front matter, with exact non-crossing source windows", () => {
  const mechanism =
    "Reference image and text feed three candidate generators: SearchSage, SigLIP2 and MagicLens. Reranking combines image similarity, text similarity and attributes.";
  const raw =
    "Author affiliations and administrative metadata. ".repeat(180) +
    "\n\n" +
    mechanism +
    "\n\n" +
    "Unrelated reference entries. ".repeat(180);
  const selected = selectExcerpt(raw, "image text candidate retrieval reranking mechanism");
  expect(selected.excerpt.length).toBeLessThanOrEqual(6000);
  expect(selected.excerpt).toContain(mechanism);
  expect(selected.excerpt.split(EXCERPT_BREAK)).toEqual(
    selected.ranges.map(({ start, end }) => raw.slice(start, end)),
  );
  const passages = passagesForSources([{ id: "source", excerpt: selected.excerpt } as Source]);
  expect(
    passages.every(
      (passage) => raw.includes(passage.text) && !passage.text.includes(EXCERPT_BREAK),
    ),
  ).toBe(true);
});
