import { Firestore } from "@google-cloud/firestore";
import { randomBytes } from "node:crypto";
import { GoogleAuth } from "google-auth-library";

export function productionDatabase() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId || process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Production requires an explicit cloud project and no emulator.");
  return new Firestore({ projectId, ignoreUndefinedProperties: true });
}
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
export async function cloudRequest(url: string, body: unknown): Promise<Response> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Cloud identity unavailable");
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}
export async function enqueue(id: string): Promise<void> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.CLOUD_REGION;
  const worker = process.env.WORKER_URL;
  const account = process.env.QUEUE_SERVICE_ACCOUNT;
  if (!project || !region || !worker || !account) throw new Error("Queue configuration missing");
  const parent = `projects/${project}/locations/${region}/queues/research`;
  const name = `${parent}/tasks/${id}-${Math.floor(Date.now() / 60_000)}`;
  const result = await cloudRequest(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
    task: {
      name,
      dispatchDeadline: "240s",
      httpRequest: {
        httpMethod: "POST",
        url: `${worker}/run`,
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ id })).toString("base64"),
        oidcToken: { serviceAccountEmail: account, audience: worker },
      },
    },
  });
  if (!result.ok && result.status !== 409) throw new Error("Queue delivery could not be scheduled");
}

export async function writeTaskTrace(
  task: { id: string; traceId: string; status: string; stage: string },
  startedAt: string,
  endedAt: string,
  steps: readonly {
    name: string;
    startMs: number;
    endMs: number;
    ok: boolean;
    attributes: Record<string, string>;
  }[] = [],
): Promise<void> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) return;
  const spanId = "0000000000000001";
  const result = await cloudRequest(
    `https://cloudtrace.googleapis.com/v2/projects/${project}/traces:batchWrite`,
    {
      spans: [
        {
          name: `projects/${project}/traces/${task.traceId}/spans/${spanId}`,
          spanId,
          displayName: { value: "research.task" },
          startTime: startedAt,
          endTime: endedAt,
          attributes: {
            attributeMap: {
              "task.id": { stringValue: { value: task.id } },
              "task.status": { stringValue: { value: task.status } },
              "task.stage": { stringValue: { value: task.stage } },
            },
          },
          status: { code: task.status === "failed" ? 2 : 0 },
          spanKind: "SERVER",
        },
        // Child spans for each step and provider call, under the same task trace.
        ...steps.map((step) => {
          const childId = randomBytes(8).toString("hex");
          return {
            name: `projects/${project}/traces/${task.traceId}/spans/${childId}`,
            spanId: childId,
            parentSpanId: spanId,
            displayName: { value: step.name.slice(0, 120) },
            startTime: new Date(step.startMs).toISOString(),
            endTime: new Date(Math.max(step.endMs, step.startMs)).toISOString(),
            attributes: {
              attributeMap: Object.fromEntries(
                Object.entries(step.attributes)
                  .slice(0, 8)
                  .map(([key, value]) => [key, { stringValue: { value: value.slice(0, 120) } }]),
              ),
            },
            status: { code: step.ok ? 0 : 2 },
            spanKind: "INTERNAL",
          };
        }),
      ],
    },
  );
  if (!result.ok) throw new Error("Trace export failed");
}
