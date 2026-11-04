"use client";
import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ReportHeading } from "../lib/report-outline";
export const ReportOutlineList = memo(function ReportOutlineList({
  headings,
  active,
  onNavigate,
}: {
  headings: ReportHeading[];
  active: string;
  onNavigate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const parents = new Map<string, string>();
  const stack: ReportHeading[] = [];
  for (const item of headings) {
    while (stack.length && stack.at(-1)!.level >= item.level) stack.pop();
    if (stack.length) parents.set(item.id, stack.at(-1)!.id);
    stack.push(item);
  }
  const activePath = new Set<string>();
  let ancestor: string | undefined = active;
  while (ancestor) {
    activePath.add(ancestor);
    ancestor = parents.get(ancestor);
  }
  const open = (id: string) => expanded[id] ?? activePath.has(id);
  const visible = (id: string): boolean => {
    const parent = parents.get(id);
    return !parent || (open(parent) && visible(parent));
  };
  return (
    <ol>
      {headings
        .filter((item) => visible(item.id))
        .map((item) => {
          const children = headings.some((child) => parents.get(child.id) === item.id);
          return (
            <li key={item.id} className={parents.has(item.id) ? "outline-child" : ""}>
              <a
                href={`#${item.id}`}
                aria-current={active === item.id ? "location" : undefined}
                onClick={(event) => {
                  if (
                    event.button ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  onNavigate(item.id);
                }}
              >
                <span className="tree-branch" aria-hidden="true" />
                {item.title}
              </a>
              {children && (
                <button
                  aria-label={`${open(item.id) ? "Collapse" : "Expand"} ${item.title}`}
                  aria-expanded={open(item.id)}
                  onClick={() => setExpanded({ ...expanded, [item.id]: !open(item.id) })}
                >
                  <ChevronRight size={13} />
                </button>
              )}
            </li>
          );
        })}
    </ol>
  );
});
