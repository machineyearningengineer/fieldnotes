/** Presentation only: the retained excerpt and claim passages remain unchanged on the server. */
function indexText(kind: string, text: string): string {
  const digits = "0123456789+-=()";
  const glyphs = kind === "sup" ? "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾" : "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎";
  return [...text].every((char) => digits.includes(char))
    ? [...text].map((char) => glyphs[digits.indexOf(char)]).join("")
    : `${kind === "sup" ? "^" : "_"}{${text}}`;
}
export function sourceText(raw: string): string {
  return (
    raw
      // Some PDF results serialize a figure/table as a quoted list item. Decode only that wrapper.
      .replace(
        /\[(["'])(<FG\b[\s\S]*?<\/FG>)\1\]/g,
        (_match, _quote: string, body: string) =>
          "\n\n" + body.replace(/\\n/g, "\n").replace(/\\t/g, "\t") + "\n\n",
      )
      .replace(/<(sup|sub)\b[^>]*>([^<>]+)<\/\1>/gi, (_match, kind: string, text: string) =>
        indexText(kind.toLowerCase(), text),
      )
      .replace(/\$(?:_\{([^{}$]+)\}|\^\{([^{}$]+)\})\$/g, (_match, sub: string, sup: string) =>
        indexText(sub !== undefined ? "sub" : "sup", sub ?? sup),
      )
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<table\b[^>]*>([\s\S]*?)(?:<\/table>|$)/gi, (_table, body: string) => {
        const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)(?:<\/tr>|$)/gi)]
          .map((row) =>
            [...row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?:<\/t[dh]>|$)/gi)].map((cell) =>
              cell[1]!
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .replace(/\|/g, "\\|")
                .trim(),
            ),
          )
          .filter((row) => row.length);
        if (!rows.length) return "\n\n";
        const width = Math.max(...rows.map((row) => row.length));
        const line = (row: string[]) =>
          "| " + Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ") + " |";
        return (
          "\n\n" +
          [line(rows[0]!), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n") +
          "\n\n"
        );
      })
      .replace(/<\/?(?:FG|F|T)\b[^>]*>/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:p|div|section|h[1-6])\b[^>]*>/gi, "\n\n")
      .replace(
        /<\/?(?:span|a|b|strong|i|em|sup|sub|caption|thead|tbody|tfoot|tr|td|th)\b[^>]*>/gi,
        "",
      )
      .replace(
        /!?\[([^\]\n]*)\]\([^\n)]*\.(?:png|jpe?g|webp)(?:[^\n)]*)\)/gi,
        (_match, alt: string) => (/^(?:_?page_|image|figure)[_\d.-]/i.test(alt) ? "" : alt),
      )
      .replace(/\[?_page_\d+_[^\s\]]+\.(?:png|jpe?g)\]?:?/gi, "")
      .replace(/\[\\?\[(\d+)\\?\]\]\(#page-[^)]+\)/g, "[$1]")
      .replace(/\[([^\]\n]+)\]\(#(?:page|figure|table)-[^)]+\)/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
export function sourceSummary(raw: string, limit = 280): string {
  const text = sourceText(raw)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cappedSummary = raw.length === 280 && !/[.!?…]$/.test(text);
  if (!cappedSummary && text.length <= limit) return text;
  const end = text.lastIndexOf(" ", Math.min(text.length - 1, limit - 1));
  return text.slice(0, end > limit / 2 ? end : limit - 1).trimEnd() + "…";
}
