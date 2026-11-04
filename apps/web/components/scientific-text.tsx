import type { ReactNode } from "react";
/**
 * Render only common source-metadata sub/superscripts, written as `$_{x}$`/`$^{x}$` or as literal
 * `<sub>`/`<sup>` tags in provider titles. Contents stay text; no HTML is interpreted.
 * Unsupported notation stays visible as text.
 */
export function ScientificText({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  let position = 0;
  for (const match of children.matchAll(
    /\$(?:_\{([^{}$]+)\}|\^\{([^{}$]+)\})\$|<sub>([^<>]{1,40})<\/sub>|<sup>([^<>]{1,40})<\/sup>/g,
  )) {
    parts.push(children.slice(position, match.index));
    const lowered = match[1] ?? match[3];
    parts.push(
      lowered !== undefined ? (
        <sub key={match.index}>{lowered}</sub>
      ) : (
        <sup key={match.index}>{match[2] ?? match[4]}</sup>
      ),
    );
    position = match.index + match[0].length;
  }
  parts.push(children.slice(position));
  return <>{parts}</>;
}
