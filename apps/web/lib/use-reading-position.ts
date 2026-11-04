"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { indexAt, readingGeometry, type ReportHeading } from "./report-outline";
export interface ReadingAnchor extends ReportHeading {
  percent: number;
}
interface Position {
  active: string;
  percent: number;
  anchors: ReadingAnchor[];
}
const focusLine = 100;
const clamp = (value: number) => Math.max(0, Math.min(100, value));
export function useReadingPosition(headings: ReportHeading[]) {
  const [position, setPosition] = useState<Position>({ active: "", percent: 0, anchors: [] });
  const restored = useRef(false);
  const readingPoint = useRef<number | null>(null);
  const updateNow = useRef<(() => void) | null>(null);
  const metrics = useRef<{
    anchors: ReadingAnchor[];
    all: Array<ReportHeading & { offset: number }>;
    offsets: number[];
    start: number;
    length: number;
    geometry: ReturnType<typeof readingGeometry>;
  } | null>(null);
  useEffect(() => {
    let frame = 0,
      needsMeasure = true;
    let pendingTarget: string | null = restored.current ? null : window.location.hash.slice(1);
    const update = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      const report = document.getElementById("report-content");
      if (!report) return;
      if (needsMeasure || !metrics.current) {
        needsMeasure = false;
        const all = headings.flatMap((heading) => {
          const element = document.getElementById(heading.id);
          return element
            ? [{ ...heading, offset: element.getBoundingClientRect().top + window.scrollY }]
            : [];
        });
        const start = all[0]?.offset ?? report.getBoundingClientRect().top + window.scrollY;
        // This is section navigation, not a document-completion meter.
        const length = Math.max(1, (all.at(-1)?.offset ?? start) - start);
        const anchors = all.map((heading) => ({
          ...heading,
          percent: clamp(((heading.offset - start) / length) * 100),
        }));
        const previous = metrics.current;
        // A larger viewport can clamp scrollY before ResizeObserver runs.
        // Preserve the last displayed reading point, not that already-moved scroll offset.
        const oldCursor = readingPoint.current ?? previous?.geometry.cursorAt(window.scrollY);
        let origin: { scroll: number; cursor: number } | undefined;
        if (previous && oldCursor !== undefined && oldCursor >= previous.start) {
          const index = indexAt(previous.offsets, oldCursor);
          const oldHeading = previous.all[index];
          const nextHeading = all.find((item) => item.id === oldHeading?.id);
          if (oldHeading && nextHeading) {
            const oldEnd = previous.offsets[index + 1] ?? previous.start + previous.length;
            const nextEnd = all[all.indexOf(nextHeading) + 1]?.offset ?? start + length;
            const fraction = Math.max(
              0,
              Math.min(
                1,
                (oldCursor - oldHeading.offset) / Math.max(1, oldEnd - oldHeading.offset),
              ),
            );
            origin = {
              scroll: window.scrollY,
              cursor: nextHeading.offset + fraction * (nextEnd - nextHeading.offset),
            };
          }
        }
        metrics.current = {
          anchors,
          all,
          offsets: all.map((item) => item.offset),
          start,
          length,
          geometry: readingGeometry(
            window.innerHeight,
            document.documentElement.scrollHeight,
            focusLine,
            origin,
          ),
        };
      }
      const cache = metrics.current;
      if (!cache) return;
      if (cache.all.length) {
        restored.current = true;
        const target = cache.all.find((item) => item.id === pendingTarget);
        pendingTarget = null;
        if (target) {
          const top = Math.max(
            0,
            Math.min(
              document.documentElement.scrollHeight - window.innerHeight,
              target.offset - focusLine,
            ),
          );
          cache.geometry = readingGeometry(
            window.innerHeight,
            document.documentElement.scrollHeight,
            focusLine,
            { scroll: top, cursor: target.offset + 0.5 },
          );
          window.scrollTo({ top, behavior: "instant" });
        }
      }
      const cursor = cache.geometry.cursorAt(window.scrollY);
      readingPoint.current = cursor;
      const active = cache.all[indexAt(cache.offsets, cursor + 0.5)]?.id ?? "";
      const percent = Math.round(clamp(((cursor - cache.start) / cache.length) * 100) * 10) / 10;
      setPosition((previous) =>
        previous.active === active &&
        previous.percent === percent &&
        previous.anchors === cache.anchors
          ? previous
          : { active, percent, anchors: cache.anchors },
      );
    };
    updateNow.current = update;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const measure = () => {
      needsMeasure = true;
      schedule();
    };
    const restoreTarget = () => {
      pendingTarget = window.location.hash.slice(1);
      schedule();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("hashchange", restoreTarget);
    window.addEventListener("popstate", restoreTarget);
    const observer = new ResizeObserver(measure);
    const report = document.getElementById("report-content");
    if (report) observer.observe(report.closest("article") ?? report);
    schedule();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      window.removeEventListener("hashchange", restoreTarget);
      window.removeEventListener("popstate", restoreTarget);
      observer.disconnect();
      cancelAnimationFrame(frame);
      updateNow.current = null;
    };
  }, [headings]);
  const move = useCallback((cursor: number, id: string | undefined, push: boolean) => {
    const cache = metrics.current;
    if (!cache) return;
    if (id && window.location.hash !== `#${id}`) {
      const address = `${window.location.pathname}${window.location.search}#${id}`;
      if (push) window.history.pushState(null, "", address);
      else window.history.replaceState(null, "", address);
    }
    const top = push
      ? Math.max(
          0,
          Math.min(
            document.documentElement.scrollHeight - window.innerHeight,
            cursor - 0.5 - focusLine,
          ),
        )
      : cache.geometry.scrollAt(cursor);
    cache.geometry = readingGeometry(
      window.innerHeight,
      document.documentElement.scrollHeight,
      focusLine,
      { scroll: top, cursor },
    );
    window.scrollTo({ top, behavior: "instant" });
    // Publish the committed position in the same update as clearing the drag preview.
    updateNow.current?.();
  }, []);
  const jump = useCallback(
    (value: number, snapToHeading = false) => {
      updateNow.current?.();
      const cache = metrics.current;
      if (!cache) return;
      const percent = clamp(value);
      const nearest = cache.anchors.reduce<ReadingAnchor | undefined>(
        (best, anchor) =>
          !best || Math.abs(anchor.percent - percent) < Math.abs(best.percent - percent)
            ? anchor
            : best,
        undefined,
      );
      const snapped =
        snapToHeading && nearest && Math.abs(nearest.percent - percent) < 1.25
          ? nearest.percent
          : percent;
      const cursor = cache.start + (cache.length * snapped) / 100;
      const anchor = cache.all[indexAt(cache.offsets, cursor + 0.5)];
      move(cursor + 0.5, anchor?.id, false);
    },
    [move],
  );
  const navigate = useCallback(
    (id: string) => {
      updateNow.current?.();
      const target = metrics.current?.all.find((item) => item.id === id);
      if (target) move(target.offset + 0.5, id, true);
    },
    [move],
  );
  return { ...position, jump, navigate };
}
