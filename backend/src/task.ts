import { randomUUID } from "node:crypto";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed";
export type SearchKind = "proprietary" | "web";

export interface SearchPlanItem {
  query: string;
  searchType: SearchKind;
  maxNumResults: number;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  sourceType?: string;
  publishedAt?: string;
  metadata: Record<string, unknown>;
}

export interface CostEntry {
  service: "valyu" | "model" | "compute" | "storage";
  usd: number;
  basis: "provider_measured" | "estimate";
  detail: string;
}

export interface TaskRecord {
  id: string;
  question: string;
  status: TaskStatus;
  progress: string;
  createdAt: string;
  updatedAt: string;
  queries: SearchPlanItem[];
  sources: Source[];
  report?: string;
  error?: string;
  costs: CostEntry[];
}

export const MAX_QUESTION_LENGTH = 500;

export function parseQuestion(input: unknown): string {
  if (typeof input !== "string") throw new Error("A research question is required.");
  const question = input.trim().replace(/\s+/g, " ");
  if (!question) throw new Error("A research question is required.");
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new Error(`The question must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
  }
  return question;
}

// The initial bounded strategy searches scholarly material and broader web context.
// It is a proposal to evaluate with real Valyu results, not a quality claim.
export function planSearches(question: string): SearchPlanItem[] {
  return [
    { query: question, searchType: "proprietary", maxNumResults: 5 },
    { query: question, searchType: "web", maxNumResults: 5 },
  ];
}

export function createTask(questionInput: unknown, now = new Date()): TaskRecord {
  const question = parseQuestion(questionInput);
  const timestamp = now.toISOString();
  return {
    id: randomUUID(), question, status: "queued", progress: "Waiting to start",
    createdAt: timestamp, updatedAt: timestamp,
    queries: planSearches(question), sources: [], costs: [],
  };
}

export function beginTask(task: TaskRecord, now = new Date()): TaskRecord {
  if (task.status !== "queued") throw new Error(`Cannot start a ${task.status} task.`);
  return { ...task, status: "running", progress: "Searching for sources", updatedAt: now.toISOString() };
}

export function completeTask(
  task: TaskRecord,
  result: { sources: Source[]; report: string; costs: CostEntry[] },
  now = new Date(),
): TaskRecord {
  if (task.status !== "running") throw new Error(`Cannot complete a ${task.status} task.`);
  if (!result.report.trim()) throw new Error("The report is empty.");
  return {
    ...task, status: "succeeded", progress: "Complete", updatedAt: now.toISOString(),
    sources: result.sources, report: result.report, costs: result.costs,
  };
}

export function failTask(task: TaskRecord, message: string, now = new Date()): TaskRecord {
  if (task.status !== "queued" && task.status !== "running") {
    throw new Error(`Cannot fail a ${task.status} task.`);
  }
  if (!message.trim()) throw new Error("A useful failure message is required.");
  return {
    ...task, status: "failed", progress: "Stopped", error: message,
    updatedAt: now.toISOString(),
  };
}

export function publicTask(task: TaskRecord) {
  return {
    id: task.id, question: task.question, status: task.status, progress: task.progress,
    createdAt: task.createdAt, updatedAt: task.updatedAt,
    queries: task.queries, sources: task.sources, report: task.report, error: task.error,
    costs: task.costs,
  };
}
