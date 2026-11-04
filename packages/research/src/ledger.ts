import { AppError, error } from "@valyu-research/contracts";
import type { TaskRecord, TraceSpan } from "./index.ts";

/** Cloud Tasks delivers at most this many attempts; the last one fails visibly. */
export const MAX_DELIVERY_ATTEMPTS = 3;

export const RESEARCH_BUDGET = {
  priceReviewAt: "2027-01-01T00:00:00Z",
  demoLifetimeMicros: 1_500_000,
  taskMicros: 100_000,
  searchMicros: 10_000,
  modelMicros: 60_000,
} as const;

export interface CostReceipt {
  complete?: boolean;
  costMicros: number;
  basis: "provider_measured" | "estimate";
  detail: string;
}
/** Settled receipts release unused allowance; uncertain calls retain their full hold. */
export function usageExposure(
  usage: readonly { state: string; reservedMicros: number; costMicros: number | null }[],
): number {
  return usage.reduce((sum, use) => {
    if (
      !Number.isSafeInteger(use.reservedMicros) ||
      use.reservedMicros < 0 ||
      (use.costMicros !== null && (!Number.isSafeInteger(use.costMicros) || use.costMicros < 0))
    )
      throw error("INTERNAL", "Invalid provider accounting amount.", 502);
    return (
      sum +
      (use.state === "settled" && use.costMicros !== null
        ? use.costMicros
        : Math.max(use.reservedMicros, use.costMicros ?? 0))
    );
  }, 0);
}
export function reserve(current: number, amount: number, limit: number): number {
  if (
    ![current, amount, limit].every(Number.isSafeInteger) ||
    current < 0 ||
    amount < 0 ||
    limit < 0 ||
    amount > limit - current
  )
    throw error("BUDGET_EXCEEDED", "This task reached its research budget.", 422);
  return current + amount;
}
type Usage = TaskRecord["snapshot"]["usage"][number];

/** Reservations left open by an interrupted attempt keep their full hold. */
export const interruptReserved = (usage: readonly Usage[], detail: string): Usage[] =>
  usage.map((use) => (use.state === "reserved" ? { ...use, state: "unknown", detail } : use));

/** A finished task has no open reservations; synthetic work costs nothing. */
export const closeReserved = (usage: readonly Usage[], simulation: boolean): Usage[] =>
  usage.map((use) =>
    use.state === "reserved"
      ? { ...use, state: "settled", costMicros: simulation ? 0 : use.costMicros }
      : use,
  );

type LedgerOptions = {
  taskId: string;
  attempt: number;
  simulation: boolean;
  receipt: (key: string) => CostReceipt | undefined;
  timings: () => Record<string, number> | undefined;
  change: (update: (record: TaskRecord) => TaskRecord) => Promise<TaskRecord>;
  span?: (span: TraceSpan) => void;
};

/**
 * The one owner of provider accounting for a task attempt. Every search, generation and
 * passage check reserves its allowance before the request and settles from its receipt after;
 * a call whose outcome is uncertain keeps its full reservation.
 */
export class TaskLedger {
  private readonly active = new Map<string, string>();
  private readonly uncharged = new WeakSet<object>();
  private blocked = false;
  // Explicit field: Node's type stripping does not support constructor parameter properties.
  private readonly options: LedgerOptions;
  constructor(options: LedgerOptions) {
    this.options = options;
  }

  async operate<T>(
    key: string,
    service: "search" | "model",
    call: () => Promise<T>,
    allowanceMicros: number = service === "search"
      ? RESEARCH_BUDGET.searchMicros
      : RESEARCH_BUDGET.modelMicros,
  ): Promise<T> {
    const { taskId, attempt, simulation } = this.options;
    const operationId = `${taskId}:${service}:${key}:${attempt}`;
    await this.options.change((record) => {
      if (record.snapshot.usage.length >= 12)
        throw error(
          "BUDGET_EXCEEDED",
          "This task reached its provider-operation limit. Saved progress is retained.",
          422,
        );
      const amount = allowanceMicros;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > RESEARCH_BUDGET.modelMicros)
        throw error("INTERNAL", "Invalid provider allowance.", 502);
      const exposure = usageExposure(record.snapshot.usage);
      if (exposure + amount > RESEARCH_BUDGET.taskMicros)
        throw error(
          "BUDGET_EXCEEDED",
          "Interrupted work cannot be retried within this task's allowance. Saved progress is retained; uncertain charges remain reserved.",
          422,
        );
      return {
        ...record,
        snapshot: {
          ...record.snapshot,
          revision: record.snapshot.revision + 1,
          updatedAt: new Date().toISOString(),
          usage: [
            ...record.snapshot.usage,
            {
              operationId,
              service,
              state: "reserved",
              reservedMicros: amount,
              costMicros: null,
              basis: simulation ? "simulation" : "estimate",
              detail: "Allowance reserved before physical provider request",
            },
          ],
        },
      };
    });
    this.active.set(operationId, key);
    const startMs = Date.now();
    let ok = false;
    try {
      const value = await call();
      await this.settle(operationId, key === "model");
      if (this.active.has(operationId))
        throw error("INTERNAL", "Provider usage could not be confirmed.", 502);
      ok = true;
      return value;
    } catch (cause) {
      const receipt = this.options.receipt(key);
      await this.settle(operationId);
      // Retries belong to the queue; it may redeliver only failures the provider confirmed were free.
      if (
        receipt &&
        receipt.costMicros === 0 &&
        receipt.complete !== false &&
        cause instanceof AppError &&
        cause.retryable
      )
        this.uncharged.add(cause);
      else this.blocked = true;
      throw cause;
    } finally {
      this.options.span?.({
        name: `provider.${service}`,
        startMs,
        endMs: Date.now(),
        ok,
        attributes: { "operation.key": key, "ledger.state": ok ? "settled" : "failed" },
      });
    }
  }

  /**
   * True only when this failure was a confirmed-free retryable rejection and no other call in
   * this attempt failed with an uncertain charge or a non-retryable error.
   */
  canRequeue(cause: unknown): boolean {
    return !this.blocked && cause instanceof Object && this.uncharged.has(cause);
  }

  /** Settle whatever has a receipt; anything without one stays reserved for the failure path. */
  async settleOutstanding(): Promise<void> {
    for (const operationId of [...this.active.keys()]) await this.settle(operationId);
  }

  private async settle(operationId: string, requireComplete = false): Promise<void> {
    const key = this.active.get(operationId);
    if (key === undefined) return;
    const receipt = this.options.simulation
      ? {
          complete: true,
          costMicros: 0,
          basis: "simulation" as const,
          detail: "Synthetic operation; no charge",
        }
      : this.options.receipt(key);
    if (!receipt) return;
    if (requireComplete && receipt.complete === false)
      throw error("INVALID_REPORT", "The model response was not complete.", 502);
    if (!Number.isSafeInteger(receipt.costMicros) || receipt.costMicros < 0)
      throw error("INTERNAL", "The provider returned an invalid usage receipt.", 502);
    const latest = await this.options.change((record) => ({
      ...record,
      snapshot: {
        ...record.snapshot,
        timings: { ...record.snapshot.timings, ...this.options.timings() },
        revision: record.snapshot.revision + 1,
        updatedAt: new Date().toISOString(),
        usage: record.snapshot.usage.map((use) =>
          use.operationId === operationId
            ? {
                ...use,
                costMicros: receipt.costMicros,
                basis: receipt.basis,
                detail: receipt.detail,
                state: receipt.complete === false ? ("unknown" as const) : ("settled" as const),
              }
            : use,
        ),
      },
    }));
    this.active.delete(operationId);
    // The settling transaction already returns the saved usage; no extra read is needed.
    if (
      latest.snapshot.usage.some(
        (use) => use.costMicros !== null && use.costMicros > use.reservedMicros,
      )
    )
      throw error(
        "BUDGET_EXCEEDED",
        "A provider exceeded its reserved allowance; research stopped.",
        502,
      );
  }
}
