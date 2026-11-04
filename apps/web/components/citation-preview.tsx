"use client";
import { useState, type ReactNode } from "react";
import { Tooltip } from "radix-ui";
import type { Source } from "@valyu-research/contracts";
import { sourceSummary } from "../lib/source-text";
import { ScientificText } from "./scientific-text";
import { sourceTypeLabel } from "../lib/source-label";
export function CitationPreview({
  source,
  number,
  children,
  onSource,
}: {
  source: Source;
  number: number;
  children: ReactNode;
  onSource: (source: Source, origin?: HTMLElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const excerpt = sourceSummary(source.excerpt, 240);
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>
        <a
          href={source.url}
          className="citation"
          aria-label={`Open source ${number}`}
          aria-haspopup="dialog"
          onClick={(event) => {
            setOpen(false);
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              onSource(source, event.currentTarget);
            }
          }}
        >
          {children}
        </a>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="citation-preview"
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          avoidCollisions
          hideWhenDetached
        >
          <span className="preview-type">
            {source.metadata.synthetic ? "Synthetic source" : sourceTypeLabel(source)}
          </span>
          <strong>
            <ScientificText>{source.title}</ScientificText>
          </strong>
          {(source.authors.length > 0 || source.publishedAt) && (
            <div className="preview-byline">
              <span>{source.authors.slice(0, 2).join(", ")}</span>
              {source.publishedAt && (
                <time dateTime={source.publishedAt}>
                  {new Date(source.publishedAt).getFullYear()}
                </time>
              )}
            </div>
          )}
          <blockquote>
            <ScientificText>{excerpt}</ScientificText>
          </blockquote>
          <Tooltip.Arrow className="preview-arrow" width={12} height={6} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export function CitationPreviewScope({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={0}>
      {children}
    </Tooltip.Provider>
  );
}
