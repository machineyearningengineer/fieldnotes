import { describe, expect, it } from "vitest";
import { indexAt, readingGeometry } from "./report-outline";

describe("reading near the document end", () => {
  it("retains the chosen heading when final headings share a physical scroll limit", () => {
    const headings = [436.4375, 593.6875, 790.6875, 918.1875, 1161.625];
    const end = 1629.2421875 - 900;
    for (const index of [2, 3, 4]) {
      const cursor = headings[index]! + 0.5;
      const scroll = Math.min(end, headings[index]! - 100);
      const geometry = readingGeometry(900, 1629.2421875, 100, { scroll, cursor });
      expect(indexAt(headings, geometry.cursorAt(scroll))).toBe(index);
      expect(geometry.scrollAt(cursor)).toBeCloseTo(scroll);
    }
  });
  it("keeps every heading reachable when several cannot reach the top inset", () => {
    // Saved short Discover report: the old clamped offsets merged its last headings.
    const headings = [436.4375, 593.6875, 790.6875, 918.1875, 1161.625];
    for (const viewport of [720, 1000, 1400]) {
      const geometry = readingGeometry(viewport, 1629.2421875, 100);
      const targets = headings.map((heading) => geometry.scrollAt(heading + 0.5));
      expect(targets.every((target, index) => index === 0 || target > targets[index - 1]!)).toBe(
        true,
      );
      expect(targets.map((target) => indexAt(headings, geometry.cursorAt(target)))).toEqual([
        0, 1, 2, 3, 4,
      ]);
      const sequence = Array.from({ length: 201 }, (_, index) =>
        indexAt(headings, geometry.cursorAt(((1629.2421875 - viewport) * index) / 200)),
      );
      expect([...new Set(sequence)]).toEqual([0, 1, 2, 3, 4]);
    }
  });
});
