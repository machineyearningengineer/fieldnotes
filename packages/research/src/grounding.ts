import { error, type Source, type TaskInput } from "@valyu-research/contracts";
export type SourcePassage = { id: string; sourceId: string; text: string };
export type GroundedClaim = { text: string; sourceId: string; passageId: string };
export const EXCERPT_BREAK = "\n\n[...]\n\n";
/** Record eligibility, not a certification of scientific quality. */
export function synthesisSources(
  input: TaskInput,
  sources: readonly Source[],
  intent?: AnswerFrame["intent"],
): Source[] {
  return input.kind !== "compare" && intent !== "evidence" && intent !== "compare"
    ? [...sources]
    : sources.filter(researchRecord);
}
/** Scholarly collections whose records can become findings; academic searches query exactly these. */
export const SCHOLARLY_SOURCES = [
  "valyu/valyu-arxiv",
  "valyu/valyu-pubmed",
  "valyu/valyu-biorxiv",
  "valyu/valyu-medrxiv",
  "valyu/valyu-chemrxiv",
];
/** A DOI link or a DOI in the URL path marks a registered scholarly publication, not its quality. */
const doiUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.hostname === "doi.org" || /(?:^|\/)10\.\d{4,9}\/\S/.test(url.pathname);
  } catch {
    return false;
  }
};
export const researchRecord = (source: Source): boolean =>
  source.sourceType === "paper" ||
  SCHOLARLY_SOURCES.includes(String(source.metadata.providerSource ?? "")) ||
  doiUrl(source.url);
export type AnswerFrame = {
  intent: "explain" | "evidence" | "compare";
  facets: { id: string; ask: string; required: boolean }[];
};
export function answerFrame(value: unknown): AnswerFrame {
  const raw = value as (Omit<AnswerFrame, "intent"> & { intent: string }) | null;
  // The journey label is a known equivalent, not permission to relax evidence requirements.
  const frame = raw
    ? ({ ...raw, intent: raw.intent === "discover" ? "evidence" : raw.intent } as AnswerFrame)
    : null;
  if (
    !frame ||
    !["explain", "evidence", "compare"].includes(frame.intent) ||
    !Array.isArray(frame.facets) ||
    frame.facets.length < 1 ||
    frame.facets.length > 5 ||
    !frame.facets.some((facet) => facet?.required === true) ||
    frame.facets.some(
      (facet) =>
        !facet ||
        !/^f[1-5]$/.test(facet.id) ||
        typeof facet.ask !== "string" ||
        !facet.ask.trim() ||
        facet.ask.length > 160 ||
        /[\r\n]/.test(facet.ask) ||
        typeof facet.required !== "boolean",
    ) ||
    new Set(frame.facets.map((facet) => facet.id)).size !== frame.facets.length
  )
    throw error("INVALID_REPORT", "The answer's coverage plan is invalid.", 502);
  return frame;
}
export function checkedCoverage(value: unknown, count: number, frame: AnswerFrame): string[][] {
  const coverage = (value as { coverage?: unknown } | null)?.coverage;
  if (
    !Array.isArray(coverage) ||
    coverage.length !== count ||
    coverage.some(
      (ids) =>
        !Array.isArray(ids) ||
        ids.length > 5 ||
        ids.some((id) => !frame.facets.some((facet) => facet.id === id)),
    )
  )
    throw error("INVALID_REPORT", "The question-coverage check returned an invalid result.", 502);
  return coverage as string[][];
}
const numericLiterals = (text: string) =>
  [...text.matchAll(/(?<![\p{L}\p{N}_])\d+(?:[.,]\d+)*/gu)].map(([n]) =>
    /^\d{1,3}(,\d{3})+$/.test(n) ? n.replaceAll(",", "") : n,
  );
/** A cheap rejection guard, not an entailment test. Conversions require explicit source support. */
export function numericAnchor(claim: string, quote: string): boolean {
  const supported = new Set(numericLiterals(quote));
  return numericLiterals(claim).every((number) => supported.has(number));
}
export function coverageNote(frame: AnswerFrame, covered: Set<string>): string {
  const missing = frame.facets.filter((facet) => facet.required && !covered.has(facet.id));
  return missing.length
    ? `## Unresolved\n\nNot established by the checked claims: ${missing.map((facet) => markdownText(facet.ask)).join("; ")}.`
    : "";
}
export function passagesForSources(sources: readonly Source[]): SourcePassage[] {
  const passages: SourcePassage[] = [];
  for (const source of sources) {
    let index = 0;
    for (const excerpt of source.excerpt.split(EXCERPT_BREAK)) {
      let start = 0,
        end = 0;
      while (start < excerpt.length && index < 10) {
        end = Math.min(start + 1200, excerpt.length);
        if (end < excerpt.length) {
          const space = excerpt.lastIndexOf(" ", end);
          if (space > start + 600) end = space;
        }
        const text = excerpt.slice(start, end).trim();
        start = end;
        if (text.length >= 16)
          passages.push({ id: `${source.id}:p${++index}`, sourceId: source.id, text });
      }
    }
  }
  return passages;
}
export type GroundedSection = { heading: string; claims: GroundedClaim[] };
export type SupportVerdict = "supported" | "partial" | "contradicted" | "insufficient";
/** Classification comes from an independent request, never from the generating model's JSONL. */
export function supportVerdicts(value: unknown, count: number): SupportVerdict[] {
  const verdicts = (value as { verdicts?: unknown } | null)?.verdicts;
  if (
    !Array.isArray(verdicts) ||
    verdicts.length !== count ||
    verdicts.some((v) => !["supported", "partial", "contradicted", "insufficient"].includes(v))
  )
    throw error("INVALID_REPORT", "The passage-support check returned an invalid result.", 502);
  return verdicts as SupportVerdict[];
}
export const markdownText = (text: string) => text.replace(/[\\`*{}[\]<>()#+.!|_~$]/g, "\\$&");
/** Models select retained passage IDs; code owns the quoted text and citation URLs. */
export function groundedSection(
  value: unknown,
  sources: readonly Source[],
  passages: readonly SourcePassage[] = passagesForSources(sources),
): { markdown: string; evidence: { sourceId: string; claim: string; quote: string }[] } {
  if (!value || typeof value !== "object")
    throw error("INVALID_REPORT", "The model returned an invalid section.", 502);
  const section = value as GroundedSection;
  if (
    typeof section.heading !== "string" ||
    section.heading.length > 120 ||
    /[\r\n]/.test(section.heading) ||
    !Array.isArray(section.claims) ||
    section.claims.length < 1 ||
    section.claims.length > 8
  )
    throw error("INVALID_REPORT", "The model returned an invalid section.", 502);
  const evidence = [];
  const paragraphs = [];
  for (const claim of section.claims) {
    const index = sources.findIndex((source) => source.id === claim?.sourceId);
    const source = sources[index];
    const passage = passages.find(
      (item) => item.id === claim?.passageId && item.sourceId === claim?.sourceId,
    );
    if (
      !source ||
      typeof claim.text !== "string" ||
      !claim.text.trim() ||
      claim.text.length > 1800 ||
      /[\r\n]/.test(claim.text) ||
      /https?:\/\/|www\./i.test(claim.text) ||
      /\[[^\]]*\]\(/.test(claim.text) ||
      !passage
    )
      throw error(
        "INVALID_REPORT",
        "A report claim has an invalid source or supporting passage.",
        502,
      );
    evidence.push({ sourceId: source.id, claim: claim.text.trim(), quote: passage.text });
    paragraphs.push(`${markdownText(claim.text.trim())} [${index + 1}](${source.url})`);
  }
  return {
    markdown: `${section.heading.trim() ? `## ${markdownText(section.heading.trim())}\n\n` : ""}${paragraphs.join("\n\n")}`,
    evidence,
  };
}
