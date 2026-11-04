import * as Schema from "effect/Schema";
import {
  TaskInputSchema,
  TaskSnapshotSchema,
  PublicErrorSchema,
  RecentTaskSchema,
} from "@valyu-research/contracts";
const schema = (value: Schema.Constraint) => {
  const document = Schema.toJsonSchemaDocument(value);
  if (Object.keys(document.definitions).length)
    throw new Error("Configure named JSON Schema references before publishing this contract.");
  return document.schema;
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ content: { "application/json": { schema: ref(name) } } });
const failure = { description: "Versioned public error", ...json("PublicError") };
const taskId = {
  name: "task_id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
export const openApiDocument = {
  openapi: "3.1.1",
  info: {
    title: "Fieldnotes research API",
    version: "1.0.0",
    description:
      "Server-owned research tasks. Discover and Compare share the same lifecycle and revisioned snapshot.",
  },
  servers: [{ url: "/api/research" }],
  security: [{ researchSession: [] }],
  paths: {
    "/health": {
      get: {
        operationId: "health",
        responses: { "401": failure, "200": { description: "Service status" } },
      },
    },
    "/tasks": {
      post: {
        operationId: "createResearch",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{8,100}$" },
          },
        ],
        requestBody: { required: true, ...json("TaskInput") },
        responses: {
          "401": failure,
          "202": { description: "Durably accepted task", ...json("TaskSnapshot") },
          "400": failure,
          "409": failure,
          "429": failure,
          "500": failure,
        },
      },
      get: {
        operationId: "recentResearch",
        responses: {
          "401": failure,
          "200": {
            description: "Recent notes belonging to this session",
            content: {
              "application/json": { schema: { type: "array", items: ref("RecentTask") } },
            },
          },
        },
      },
    },
    "/tasks/{task_id}": {
      get: {
        operationId: "getResearch",
        parameters: [taskId, { name: "If-None-Match", in: "header", schema: { type: "string" } }],
        responses: {
          "401": failure,
          "200": { description: "Current authoritative snapshot", ...json("TaskSnapshot") },
          "304": { description: "Revision unchanged; no response body" },
          "404": failure,
        },
      },
    },
    "/tasks/{task_id}/events": {
      get: {
        operationId: "streamResearch",
        parameters: [taskId],
        description:
          "SSE snapshot events contain the complete TaskSnapshot JSON. Event ID is its revision. The initial event is the latest saved state; intermediate revisions may be coalesced. The connection closes after 55 seconds or a terminal state. On interruption, reconnect or poll GET with its ETag; discard duplicate/older revisions.",
        responses: {
          "401": failure,
          "200": {
            description: "Revisioned snapshot stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          "404": failure,
        },
      },
    },
    "/tasks/{task_id}/recent": {
      patch: {
        operationId: "setRecentVisibility",
        parameters: [taskId],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["visible"],
                properties: { visible: { type: "boolean" } },
              },
            },
          },
        },
        responses: {
          "401": failure,
          "204": { description: "Visibility updated; task retained" },
          "404": failure,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      researchSession: {
        type: "apiKey",
        in: "cookie",
        name: "fieldnotes-session",
        description:
          "Exchange the evaluator access code at POST /api/session using a same-origin form request. The HttpOnly session cookie identifies the owner; the browser never receives Google credentials.",
      },
    },
    schemas: {
      TaskInput: schema(TaskInputSchema),
      TaskSnapshot: schema(TaskSnapshotSchema),
      PublicError: schema(PublicErrorSchema),
      RecentTask: schema(RecentTaskSchema),
    },
  },
};
