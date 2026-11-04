import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

export const MAX_SNAPSHOT_BYTES = 240_000;
export const STREAM_LIFETIME_MS = 55_000;
export const INPUT_LIMITS = { question: 500, alternative: 120, maxAlternatives: 2 } as const;
const Question = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(INPUT_LIMITS.question),
);
const Alternative = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(INPUT_LIMITS.alternative),
);
export const TaskInputSchema = Schema.Union([
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("discover"),
    question: Question,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("compare"),
    question: Question,
    alternatives: Schema.Array(Alternative).check(
      Schema.isMinLength(2),
      Schema.isMaxLength(INPUT_LIMITS.maxAlternatives),
    ),
  }),
]);
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
export type TaskInput = Mutable<typeof TaskInputSchema.Type>;
export class AppError extends Data.TaggedError("AppError")<{
  code: ErrorCode;
  message: string;
  status: number;
  retryable: boolean;
}> {}
export const error = (code: ErrorCode, message: string, status = 400, retryable = false) =>
  new AppError({ code, message, status, retryable });
export function parseInput(value: unknown): TaskInput {
  let input: TaskInput;
  try {
    input = Schema.decodeUnknownSync(TaskInputSchema)(value) as TaskInput;
  } catch {
    throw error(
      "INVALID_INPUT",
      "Enter a question of 1–500 characters. Compare needs two different alternatives.",
    );
  }
  const question = input.question.trim().replace(/\s+/g, " ");
  if (!question) throw error("INVALID_INPUT", "Enter a research question.");
  if (input.kind === "compare") {
    const alternatives = input.alternatives.map((item) => item.trim().replace(/\s+/g, " "));
    if (
      alternatives.some((item) => !item) ||
      alternatives[0]?.toLowerCase() === alternatives[1]?.toLowerCase()
    )
      throw error("INVALID_INPUT", "Name two different alternatives.");
    return { ...input, question, alternatives };
  }
  return { ...input, question };
}
const Short = Schema.String.check(Schema.isMaxLength(500));
const Text = Schema.String.check(Schema.isMaxLength(35_000));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
export const ErrorCodeSchema = Schema.Literals([
  "INVALID_INPUT",
  "NOT_FOUND",
  "FORBIDDEN",
  "CONFLICT",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "SEARCH_TIMEOUT",
  "NO_EVIDENCE",
  "INVALID_REPORT",
  "DEADLINE_EXCEEDED",
  "INTERNAL",
]);
export type ErrorCode = typeof ErrorCodeSchema.Type;
export const TaskStatusSchema = Schema.Literals(["queued", "running", "succeeded", "failed"]);
export type TaskStatus = typeof TaskStatusSchema.Type;
/** What the finished task established, separate from whether it ran. Additive to schema version 1. */
export const OutcomeSchema = Schema.Literals(["answered", "partial", "unanswered", "failed"]);
export type Outcome = typeof OutcomeSchema.Type;
export const StageSchema = Schema.Literals([
  "queued",
  "searching",
  "writing",
  "checking",
  "complete",
  "failed",
]);
export type Stage = typeof StageSchema.Type;
export const SearchQuerySchema = Schema.Struct({
  id: Short,
  query: Short,
  purpose: Short,
  sourceType: Schema.Literals(["academic", "web"]),
  status: Schema.Literals(["planned", "complete"]),
  sourceIds: Schema.Array(Short).check(Schema.isMaxLength(8)),
});
export type SearchQuery = Mutable<typeof SearchQuerySchema.Type>;
export const SourceSchema = Schema.Struct({
  id: Short,
  title: Short,
  url: Short,
  authors: Schema.Array(Short).check(Schema.isMaxLength(20)),
  publishedAt: Schema.NullOr(Short),
  sourceType: Short,
  excerpt: Schema.String.check(Schema.isMaxLength(6000)),
  relevance: Schema.String.check(Schema.isMaxLength(2000)),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  queryIds: Schema.Array(Short).check(Schema.isMaxLength(3)),
});
export type Source = Mutable<typeof SourceSchema.Type>;
export const UsageEntrySchema = Schema.Struct({
  operationId: Short,
  service: Schema.Literals(["search", "model"]),
  state: Schema.Literals(["reserved", "settled", "unknown"]),
  reservedMicros: Count,
  costMicros: Schema.NullOr(Count),
  basis: Schema.Literals(["simulation", "provider_measured", "estimate"]),
  detail: Short,
});
export type UsageEntry = typeof UsageEntrySchema.Type;
export const ProgressEventSchema = Schema.Struct({
  sequence: Positive,
  at: Short,
  stage: StageSchema,
  message: Short,
});
export type ProgressEvent = typeof ProgressEventSchema.Type;
export const ReportBlockSchema = Schema.Struct({ id: Short, markdown: Text });
export type ReportBlock = typeof ReportBlockSchema.Type;
export const ReportDraftSchema = Schema.Struct({
  blocks: Schema.Array(ReportBlockSchema).check(Schema.isMaxLength(40)),
});
export type ReportDraft = typeof ReportDraftSchema.Type;
export const TaskSnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Short,
  input: TaskInputSchema,
  status: TaskStatusSchema,
  outcome: Schema.optional(OutcomeSchema),
  stage: StageSchema,
  revision: Positive,
  createdAt: Short,
  updatedAt: Short,
  expiresAt: Short,
  simulation: Schema.Boolean,
  queries: Schema.Array(SearchQuerySchema).check(Schema.isMaxLength(3)),
  sources: Schema.Array(SourceSchema).check(Schema.isMaxLength(8)),
  reportDraft: Schema.NullOr(ReportDraftSchema),
  report: Schema.NullOr(Text),
  error: Schema.NullOr(
    Schema.Struct({
      code: ErrorCodeSchema,
      message: Short,
      retryable: Schema.Boolean,
      traceId: Short,
    }),
  ),
  usage: Schema.Array(UsageEntrySchema).check(Schema.isMaxLength(12)),
  events: Schema.Array(ProgressEventSchema).check(Schema.isMaxLength(40)),
  traceId: Short,
  timings: Schema.Record(Schema.String, Count),
});
export type TaskSnapshot = Mutable<typeof TaskSnapshotSchema.Type>;
export const RecentTaskSchema = Schema.Struct({
  id: Short,
  kind: Schema.Literals(["discover", "compare"]),
  question: Question,
  status: TaskStatusSchema,
  createdAt: Short,
});
export type RecentTask = typeof RecentTaskSchema.Type;
export const PublicErrorSchema = Schema.Struct({
  version: Schema.Literal(1),
  code: ErrorCodeSchema,
  message: Short,
  retryable: Schema.Boolean,
  requestId: Short,
  traceId: Short,
  taskId: Schema.optional(Short),
});
export type PublicError = typeof PublicErrorSchema.Type;
export const decodePublicError = (value: unknown): PublicError =>
  Schema.decodeUnknownSync(PublicErrorSchema)(value);
export function decodeSnapshot(expectedId: string, value: unknown): TaskSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid task snapshot");
  const candidate = value as Record<string, unknown>;
  const normalized = { ...candidate, reportDraft: candidate.reportDraft ?? null };
  const decoded = Schema.decodeUnknownSync(TaskSnapshotSchema)(normalized);
  if (
    new TextEncoder().encode(JSON.stringify(normalized)).length > MAX_SNAPSHOT_BYTES ||
    decoded.sources.some((source) => JSON.stringify(source.metadata).length > 8_000) ||
    decoded.id !== expectedId ||
    !Number.isSafeInteger(decoded.revision)
  )
    throw new Error("Invalid task snapshot identity or revision");
  const blocks = decoded.reportDraft?.blocks ?? [];
  const joined = blocks.map((block) => block.markdown).join("\n\n");
  if (
    new Set(blocks.map((block) => block.id)).size !== blocks.length ||
    joined.length > 35_000 ||
    new Set(decoded.sources.map((source) => source.id)).size !== decoded.sources.length ||
    (decoded.status === "succeeded" &&
      (!decoded.report || (blocks.length > 0 && joined !== decoded.report))) ||
    (decoded.status === "failed" && !decoded.error)
  )
    throw new Error("Invalid task snapshot state");
  return decoded as TaskSnapshot;
}
export const terminal = (task: Pick<TaskSnapshot, "status">) =>
  task.status === "succeeded" || task.status === "failed";
export function newerSnapshot(
  previous: TaskSnapshot | undefined,
  next: TaskSnapshot,
): TaskSnapshot {
  return previous && previous.id === next.id && previous.revision >= next.revision
    ? previous
    : next;
}
export const publicError = (cause: AppError, requestId: string, taskId?: string): PublicError => ({
  version: 1,
  code: cause.code,
  message: cause.message,
  retryable: cause.retryable,
  requestId,
  traceId: requestId,
  ...(taskId ? { taskId } : {}),
});
