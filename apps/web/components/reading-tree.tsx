"use client";
import { useCallback, useMemo, useState } from "react";
import { ChevronDown, SquarePen } from "lucide-react";
import { indexAt, type ReportHeading } from "../lib/report-outline";
import { useReadingPosition } from "../lib/use-reading-position";
import { useMediaQuery } from "../lib/use-media-query";
import { ReportOutlineList } from "./report-outline-list";
export type { ReportHeading } from "../lib/report-outline";
export function ReadingTree({
  headings,
  onNew,
}: {
  headings: ReportHeading[];
  onNew: (trigger: HTMLButtonElement) => void;
}) {
  const position = useReadingPosition(headings);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [previewPercent, setPreviewPercent] = useState<number | null>(null);
  const compact = useMediaQuery("(max-width:900px)");
  const navigateToHeading = position.navigate;
  const navigate = useCallback(
    (id: string) => {
      setMobileOpen(false);
      navigateToHeading(id);
    },
    [navigateToHeading],
  );
  const allPositions = useMemo(
    () => position.anchors.map((item) => item.percent),
    [position.anchors],
  );
  const mainAnchors = useMemo(() => {
    const level = Math.min(...position.anchors.map((item) => item.level));
    return position.anchors.filter((item) => item.level === level);
  }, [position.anchors]);
  const mainPositions = useMemo(() => mainAnchors.map((item) => item.percent), [mainAnchors]);
  const percent = previewPercent ?? position.percent;
  const previewHeading = position.anchors[indexAt(allPositions, percent)];
  const label =
    previewPercent === null
      ? (headings.find((item) => item.id === position.active)?.title ?? previewHeading?.title)
      : previewHeading?.title;
  const activePercent =
    previewPercent ??
    position.anchors.find((item) => item.id === position.active)?.percent ??
    percent;
  const activeMain = mainAnchors[indexAt(mainPositions, activePercent)];
  const strong = new Set<string>();
  if (mainAnchors.length) {
    strong.add(mainAnchors[0]!.id);
    strong.add(mainAnchors.at(-1)!.id);
    if (activeMain) strong.add(activeMain.id);
    for (let i = 0; i < 12 && strong.size < 12; i++)
      strong.add(mainAnchors[Math.round((i * (mainAnchors.length - 1)) / 11)]!.id);
  }
  const landmarks = mainAnchors.filter((item) => strong.has(item.id));
  function jump(value: number, snapToHeading = false) {
    position.jump(value, snapToHeading);
    setPreviewPercent(null);
  }
  if (!headings.length)
    return (
      <nav className="reading-tree" aria-label="Research actions">
        <button className="new-research-label" onClick={(event) => onNew(event.currentTarget)}>
          <SquarePen size={15} />
          New research
        </button>
      </nav>
    );
  return (
    <nav className={`reading-tree ${mobileOpen ? "mobile-open" : ""}`} aria-label="In this note">
      <div className="reading-toolbar">
        <button
          className="contents-toggle"
          aria-expanded={mobileOpen}
          aria-controls="report-outline"
          aria-label="Browse report sections"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <span>{label ?? "Contents"}</span>
          <ChevronDown size={15} />
        </button>
        <button
          className="new-research-icon"
          aria-label="New research"
          title="New research"
          onClick={(event) => onNew(event.currentTarget)}
        >
          <SquarePen size={16} />
        </button>
      </div>
      <div className="section-scrubber">
        <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
          {landmarks.map((anchor) => (
            <line
              key={anchor.id}
              x1={anchor.percent}
              x2={anchor.percent}
              y1="3"
              y2="22"
              vectorEffect="non-scaling-stroke"
              className={anchor.id === activeMain?.id ? "current" : ""}
            />
          ))}
          {Array.from({ length: 41 }, (_, index) => {
            const at = index * 2.5,
              proximity = Math.max(0, 1 - Math.abs(at - percent) / 5);
            return (
              <line
                key={`minor-${index}`}
                x1={at}
                x2={at}
                y1={18 - proximity * 5}
                y2="22"
                vectorEffect="non-scaling-stroke"
                className={`minor ${proximity > 0.15 ? "near-cursor" : ""}`}
                style={{ opacity: 0.45 + proximity * 0.55 }}
              />
            );
          })}
        </svg>
        <input
          type="range"
          disabled={!position.anchors.length}
          min={0}
          max={100}
          step={0.1}
          value={percent}
          aria-label="Reading position"
          aria-valuetext={`${Math.round(percent)}%: ${label ?? "Report"}`}
          onPointerDown={() => setMobileOpen(false)}
          onChange={(event) => setPreviewPercent(Number(event.target.value))}
          onPointerUp={(event) => jump(Number(event.currentTarget.value), true)}
          onPointerCancel={() => setPreviewPercent(null)}
          onKeyDown={(event) => {
            const moves: Record<string, number> = {
              ArrowLeft: -1,
              ArrowDown: -1,
              ArrowRight: 1,
              ArrowUp: 1,
              PageDown: 10,
              PageUp: -10,
            };
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              jump(event.key === "Home" ? 0 : 100);
            } else if (event.key in moves) {
              event.preventDefault();
              jump(Math.max(0, Math.min(100, percent + moves[event.key]!)));
            }
          }}
          onBlur={() => setPreviewPercent(null)}
        />
      </div>
      <div id="report-outline" className="outline-content">
        <span className="outline-label">In this note</span>
        {(!compact || mobileOpen) && (
          <ReportOutlineList headings={headings} active={position.active} onNavigate={navigate} />
        )}
        <progress
          className="reading-position"
          aria-label="Reading position"
          value={position.percent}
          max={100}
        />
      </div>
    </nav>
  );
}
