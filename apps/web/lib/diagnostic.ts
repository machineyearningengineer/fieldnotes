import { decodePublicError, type PublicError, type TaskSnapshot } from "@valyu-research/contracts";
export interface Diagnostic {
  version: 1;
  boundary: "api" | "client-connection";
  message: string;
  requestId?: string;
  taskId?: string;
  reference?: string;
  code?: PublicError["code"];
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly details: PublicError | null,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
export class AccessError extends ApiError {}
export async function responseError(response: Response) {
  let details: PublicError | null = null;
  try {
    details = decodePublicError(await response.json());
  } catch {}
  const message = details?.message ?? "Research is temporarily unavailable.";
  const ErrorClass = [400, 401, 403, 404, 410].includes(response.status) ? AccessError : ApiError;
  return new ErrorClass(
    message,
    details,
    details?.requestId ?? response.headers.get("X-Request-Id") ?? undefined,
  );
}
export function diagnosticFor(
  cause: unknown,
  task?: Pick<TaskSnapshot, "id" | "traceId">,
): Diagnostic {
  const failure =
    cause instanceof Error ? cause : new Error("The connection could not be completed.");
  return {
    version: 1,
    boundary: failure instanceof ApiError ? "api" : "client-connection",
    message: failure.message,
    ...(task ? { taskId: task.id, reference: task.traceId } : {}),
    ...(failure instanceof ApiError
      ? {
          requestId: failure.requestId,
          code: failure.details?.code,
          ...(!task && failure.details?.taskId ? { taskId: failure.details.taskId } : {}),
        }
      : {}),
  };
}
