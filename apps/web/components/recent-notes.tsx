"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import type { RecentTask } from "@valyu-research/contracts";
export function RecentNotes() {
  const [editingRecent, setEditingRecent] = useState(false);
  const queryClient = useQueryClient();
  const [removed, setRemoved] = useState<RecentTask | null>(null);
  const recentVisibility = useMutation({
    mutationFn: async ({ task, visible }: { task: RecentTask; visible: boolean }) => {
      const response = await fetch(`/api/research/tasks/${task.id}/recent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible }),
      });
      if (!response.ok) throw new Error("Couldn’t update recent notes. Please try again.");
      return { task, visible };
    },
    onSuccess: async ({ task, visible }) => {
      setRemoved(visible ? null : task);
      await queryClient.invalidateQueries({ queryKey: ["recent", "local-researcher"] });
    },
  });
  const recent = useQuery<RecentTask[]>({
    queryKey: ["recent", "local-researcher"],
    queryFn: async () => {
      const response = await fetch("/api/research/tasks");
      if (!response.ok) throw new Error("Recent notes are unavailable");
      return response.json();
    },
    staleTime: 0,
    retry: false,
  });
  return (
    <>
      {recent.data?.length || removed ? (
        <section className="recent-section">
          <div className="section-heading">
            <h2>Recent notes</h2>
            <button className="recent-edit" onClick={() => setEditingRecent(!editingRecent)}>
              {editingRecent ? "Done" : "Edit"}
            </button>
          </div>
          {recent.data?.map((task) => (
            <div className="recent-row" key={task.id}>
              <Link className="recent-item" href={`/tasks/${task.id}`}>
                <span className="recent-kind">{task.kind}</span>
                <span>{task.question}</span>
                <ArrowUpRight size={16} />
              </Link>
              {editingRecent && (
                <button
                  className="remove-note"
                  aria-label={`Remove ${task.question} from recent notes`}
                  title="Remove from recent notes"
                  disabled={recentVisibility.isPending}
                  onClick={() => recentVisibility.mutate({ task, visible: false })}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          {removed && (
            <output className="recent-feedback">
              <span>Note removed from recent.</span>
              <button
                disabled={recentVisibility.isPending}
                onClick={() => recentVisibility.mutate({ task: removed, visible: true })}
              >
                Undo
              </button>
            </output>
          )}
        </section>
      ) : null}
      {recentVisibility.error && (
        <p className="recent-error" role="alert">
          {recentVisibility.error.message}
        </p>
      )}
    </>
  );
}
