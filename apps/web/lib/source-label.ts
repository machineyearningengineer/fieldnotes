import type { Source } from "@valyu-research/contracts";
export function sourceTypeLabel(source: Source): string {
  // Early local fixtures stored simulation as joined display text. It now has its own state.
  return source.metadata.synthetic
    ? source.sourceType.replace(/\s*[·•]\s*simulated$/i, "")
    : source.sourceType;
}
