"use client";
import { useEffect, useState } from "react";
import type { TaskSnapshot } from "@valyu-research/contracts";
export function DraftState({ task, connected }: { task: TaskSnapshot; connected: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (task.status === "failed") return;
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(task.updatedAt)) / 1000)));
    tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [task.updatedAt, task.status]);
  const label =
    task.status === "failed"
      ? "Unfinished draft"
      : !connected
        ? "Saved draft"
        : elapsed >= 30
          ? "Waiting for an update"
          : task.stage === "checking"
            ? "Checking draft…"
            : "Writing draft…";
  return (
    <output className="draft-state">
      {task.status !== "failed" && connected && elapsed < 30 && (
        <span className="ink-spinner" aria-hidden="true" />
      )}
      <span>{label}</span>
      {elapsed >= 30 && task.status !== "failed" && (
        <span className="draft-waiting">Last progress {elapsed}s ago</span>
      )}
    </output>
  );
}
