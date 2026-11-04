"use client";
import { useSyncExternalStore } from "react";
import { INPUT_LIMITS } from "@valyu-research/contracts";
type Journey = "discover" | "compare";
export interface ResearchDraft {
  question: string;
  first: string;
  second: string;
  submissionKey: string | null;
  savedAt: number;
}
const empty: ResearchDraft = {
  question: "",
  first: "",
  second: "",
  submissionKey: null,
  savedAt: 0,
};
const values = new Map<Journey, ResearchDraft>();
const listeners = new Set<() => void>();
const storageKey = (kind: Journey) => `fieldnotes:draft:local-researcher:${kind}`;
const subscribe = (changed: () => void) => {
  listeners.add(changed);
  return () => listeners.delete(changed);
};
function read(kind: Journey): ResearchDraft {
  if (typeof window === "undefined") return empty;
  const cached = values.get(kind);
  if (cached) return cached;
  let value = empty;
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(storageKey(kind)) ?? "null");
    if (
      raw &&
      typeof raw === "object" &&
      "savedAt" in raw &&
      typeof raw.savedAt === "number" &&
      raw.savedAt <= Date.now() &&
      Date.now() - raw.savedAt < 8 * 60 * 60 * 1000 &&
      "question" in raw &&
      typeof raw.question === "string" &&
      raw.question.length <= INPUT_LIMITS.question &&
      "first" in raw &&
      typeof raw.first === "string" &&
      raw.first.length <= INPUT_LIMITS.alternative &&
      "second" in raw &&
      typeof raw.second === "string" &&
      raw.second.length <= INPUT_LIMITS.alternative
    ) {
      const key =
        "submissionKey" in raw &&
        typeof raw.submissionKey === "string" &&
        /^[a-f0-9-]{36}$/.test(raw.submissionKey)
          ? raw.submissionKey
          : null;
      value = {
        question: raw.question,
        first: raw.first,
        second: raw.second,
        submissionKey: key,
        savedAt: raw.savedAt,
      };
    }
  } catch {
    /* Storage is optional; the current tab can still hold a draft in memory. */
  }
  values.set(kind, value);
  return value;
}
export function updateResearchDraft(kind: Journey, patch: Partial<Omit<ResearchDraft, "savedAt">>) {
  const next = { ...read(kind), ...patch, savedAt: Date.now() };
  values.set(kind, next);
  try {
    sessionStorage.setItem(storageKey(kind), JSON.stringify(next));
  } catch {}
  for (const changed of listeners) changed();
}
export function clearResearchDraft(kind: Journey) {
  values.set(kind, empty);
  try {
    sessionStorage.removeItem(storageKey(kind));
  } catch {}
  for (const changed of listeners) changed();
}
export function useResearchDraft(kind: Journey) {
  return useSyncExternalStore(
    subscribe,
    () => read(kind),
    () => empty,
  );
}
