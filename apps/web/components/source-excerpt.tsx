"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sourceText } from "../lib/source-text";
const plugins = [remarkGfm];
export function SourceExcerpt({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = sourceText(text);
  const paragraphs = formatted.split(/\n\s*\n/);
  let preview = "";
  for (const paragraph of paragraphs) {
    if (preview && preview.length + paragraph.length > 1100) break;
    preview += (preview ? "\n\n" : "") + paragraph;
  }
  // One long extraction paragraph is still bounded; the full retained text remains available.
  if (preview.length > 1500) {
    const end = preview.lastIndexOf(" ", 1100);
    preview = preview.slice(0, end > 0 ? end : 1100) + "…";
  }
  const shortened = preview !== formatted;
  return (
    <div className="source-extract">
      <div className="source-extract-body">
        <ReactMarkdown
          remarkPlugins={plugins}
          skipHtml
          components={{
            a: ({ children }) => <span>{children}</span>,
            img: ({ alt }) => (alt ? <span>{alt}</span> : null),
            table: ({ children }) => (
              <div className="source-table">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {expanded ? formatted : preview}
        </ReactMarkdown>
      </div>
      {shortened && (
        <button
          type="button"
          className="excerpt-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Read more extracted text"}
        </button>
      )}
    </div>
  );
}
