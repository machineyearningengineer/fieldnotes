export interface ReportHeading {
  id: string;
  title: string;
  level: number;
}
// The last landmark at or before a position. Arrays follow document order.
export function indexAt(positions: readonly number[], value: number): number {
  let low = 0,
    high = positions.length - 1,
    result = 0;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (positions[middle]! <= value) {
      result = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return result;
}

// Move the reading line down through the final viewport instead of collapsing
// headings that cannot physically reach the usual top inset onto one scroll offset.
export function readingGeometry(
  viewportHeight: number,
  scrollHeight: number,
  inset: number,
  origin?: { scroll: number; cursor: number },
) {
  const maxScroll = Math.max(0, scrollHeight - viewportHeight);
  const top = Math.min(inset, viewportHeight);
  const extra = viewportHeight - top;
  const tail = Math.min(maxScroll, extra);
  const tailStart = maxScroll - tail;
  const bound = (value: number) => Math.max(0, Math.min(maxScroll, value));
  const base = {
    cursorAt(scroll: number) {
      const y = bound(scroll);
      return y + top + (tail > 0 ? extra * Math.max(0, (y - tailStart) / tail) : 0);
    },
    scrollAt(cursor: number) {
      const normal = cursor - top;
      return bound(
        tail > 0 && normal > tailStart
          ? tailStart + (normal - tailStart) / (1 + extra / tail)
          : normal,
      );
    },
  };
  if (!origin) return base;
  const pivot = base.cursorAt(origin.scroll);
  return {
    cursorAt(scroll: number) {
      if (scroll === origin.scroll) return origin.cursor;
      const cursor = base.cursorAt(scroll);
      return scroll < origin.scroll
        ? top + ((origin.cursor - top) * (cursor - top)) / Math.max(1, pivot - top)
        : origin.cursor +
            ((scrollHeight - origin.cursor) * (cursor - pivot)) / Math.max(1, scrollHeight - pivot);
    },
    scrollAt(cursor: number) {
      const position =
        cursor < origin.cursor
          ? top + ((pivot - top) * (cursor - top)) / Math.max(1, origin.cursor - top)
          : pivot +
            ((scrollHeight - pivot) * (cursor - origin.cursor)) /
              Math.max(1, scrollHeight - origin.cursor);
      return base.scrollAt(position);
    },
  };
}
