"use client";
import { memo, useState } from "react";
import type { ReportBlock, Source } from "@valyu-research/contracts";
import { ReportMarkdown } from "./report-markdown";

export const ReportBody = memo(function ReportBody({
  blocks,
  report,
  sources,
  onSource,
  animateInitial = false,
}: {
  blocks: readonly ReportBlock[] | null;
  animateInitial?: boolean;
  report: string | null;
  sources: Source[];
  onSource: (source: Source, origin?: HTMLElement) => void;
}) {
  // Restored content is immediately readable; only sections appended to this view animate.
  const [initial] = useState(() => new Set(animateInitial ? [] : blocks?.map((block) => block.id)));
  if (!blocks?.length)
    return report ? <ReportMarkdown text={report} sources={sources} onSource={onSource} /> : null;
  const sections: Array<{ block: ReportBlock; start: number }> = [];
  let offset = 0;
  for (const block of blocks) {
    sections.push({ block, start: offset });
    offset += block.markdown.length + 2;
  }
  return sections.map(({ block, start }) => {
    return (
      <section
        key={block.id}
        className={`report-block${initial.has(block.id) ? "" : " report-block-arrive"}`}
        data-block-id={block.id}
      >
        <ReportMarkdown
          text={block.markdown}
          offset={start}
          sources={sources}
          onSource={onSource}
        />
      </section>
    );
  });
});
