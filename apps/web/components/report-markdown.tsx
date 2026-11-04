"use client";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Source } from "@valyu-research/contracts";
import { CitationPreview, CitationPreviewScope } from "./citation-preview";
const plugins = [remarkGfm];
export const ReportMarkdown = memo(function ReportMarkdown({
  text,
  sources,
  onSource,
  offset = 0,
}: {
  text: string;
  offset?: number;
  sources: Source[];
  onSource: (source: Source, origin?: HTMLElement) => void;
}) {
  return (
    <CitationPreviewScope>
      <ReactMarkdown
        remarkPlugins={plugins}
        components={{
          h1: ({ node, children }) => (
            <h2 id={`section-${offset + (node?.position?.start.offset ?? 0)}`}>{children}</h2>
          ),
          h2: ({ node, children }) => (
            <h2 id={`section-${offset + (node?.position?.start.offset ?? 0)}`}>{children}</h2>
          ),
          h3: ({ node, children }) => (
            <h3 id={`section-${offset + (node?.position?.start.offset ?? 0)}`}>{children}</h3>
          ),
          h4: ({ node, children }) => (
            <h4 id={`section-${offset + (node?.position?.start.offset ?? 0)}`}>{children}</h4>
          ),
          img: ({ alt }) => <span>{alt ? `Figure: ${alt}` : "Figure omitted"}</span>,
          a: ({ href, children }) => {
            const item = sources.find((source) => source.url === href);
            return item ? (
              <CitationPreview source={item} number={sources.indexOf(item) + 1} onSource={onSource}>
                {children}
              </CitationPreview>
            ) : (
              <span>{children}</span>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </CitationPreviewScope>
  );
});
