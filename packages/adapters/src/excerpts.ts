import { EXCERPT_BREAK } from "@valyu-research/research/grounding";
const stop = new Set(
  "the and for are was were this that with from how what which why does do did can could would should about into its their them they has have also evidence research explain published limits parts combine".split(
    " ",
  ),
);
/** Retain original contiguous windows, not just a document's cover page. No model call. */
export function selectExcerpt(content: string, question: string) {
  if (content.length <= 6000)
    return { excerpt: content, ranges: [{ start: 0, end: content.length }] };
  const terms = [
    ...new Set(
      (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (term) => term.length >= 3 && !stop.has(term),
      ),
    ),
  ];
  const windows: { start: number; end: number; score: number }[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + 1100, content.length);
    if (end < content.length) {
      const paragraph = content.lastIndexOf("\n\n", end);
      const sentence = content.lastIndexOf(". ", end);
      const space = content.lastIndexOf(" ", end);
      if (paragraph > start + 500) end = paragraph;
      else if (sentence > start + 500) end = sentence + 1;
      else if (space > start + 500) end = space;
    }
    const raw = content.slice(start, end);
    const text = raw.trim();
    const offset = raw.indexOf(text);
    if (text.length >= 16) {
      const lower = text.toLowerCase();
      windows.push({
        start: start + offset,
        end: start + offset + text.length,
        score: terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0),
      });
    }
    start = end;
  }
  const ranges = windows
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, 5)
    .sort((a, b) => a.start - b.start)
    .map(({ start, end }) => ({ start, end }));
  return {
    excerpt: ranges.map(({ start, end }) => content.slice(start, end)).join(EXCERPT_BREAK),
    ranges,
  };
}
