import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  AppError,
  STREAM_LIFETIME_MS,
  decodeSnapshot,
  error,
  parseInput,
  publicError,
  terminal,
} from "@valyu-research/contracts";
import { RESEARCH_BUDGET, ResearchService } from "@valyu-research/research";
import { FixtureProviders, FirestoreTaskStore, localDatabase } from "@valyu-research/adapters";
import { productionDatabase, enqueue } from "@valyu-research/adapters/cloud";

const production = process.env.APP_MODE === "production";
if (!production && process.env.APP_MODE !== "local") throw new Error("Set APP_MODE explicitly.");
const store = new FirestoreTaskStore(
  production ? productionDatabase() : localDatabase(),
  production ? RESEARCH_BUDGET.demoLifetimeMicros : null,
);
const fixtures = new FixtureProviders();
const service = new ResearchService(store, {
  simulation: !production,
  search: fixtures.search.bind(fixtures),
  synthesise: fixtures.synthesise.bind(fixtures),
});
const allowedOrigin = process.env.WEB_ORIGIN ?? "http://localhost:23100";
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 23120);
const respond = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": res.getHeader("Cache-Control") ?? "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw error("INVALID_INPUT", "This request is too large.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw error("INVALID_INPUT", "Send a valid JSON research question.");
  }
}
function owner(req: IncomingMessage): string {
  const value = req.headers[production ? "x-research-owner" : "x-local-user"];
  if (production && (typeof value !== "string" || !/^[a-z0-9-]{1,40}$/.test(value)))
    throw error("FORBIDDEN", "A research session is required.", 403);
  return typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value) ? value : "local-researcher";
}
async function owned(id: string, user: string) {
  const record = await store.get(id);
  if (!record || record.owner !== user)
    throw error("NOT_FOUND", "This research task is unavailable.", 404);
  return record;
}
const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const started = performance.now();
  let taskId: string | undefined;
  let reference: string | undefined;
  let route = "unknown";
  let logged = false;
  res.setHeader("X-Request-Id", requestId);
  const log = () => {
    if (logged) return;
    logged = true;
    console.log(
      JSON.stringify({
        event: "http.request",
        service: "api",
        requestId,
        taskId,
        reference,
        ...(reference && production
          ? {
              "logging.googleapis.com/trace": `projects/${process.env.GOOGLE_CLOUD_PROJECT}/traces/${reference}`,
            }
          : {}),
        route,
        method: req.method,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  };
  res.once("finish", log);
  res.once("close", log);
  const url = new URL(req.url ?? "/", "http://localhost");
  const origin = req.headers.origin;
  if (origin && origin !== allowedOrigin) {
    respond(res, 403, publicError(error("FORBIDDEN", "Origin not allowed.", 403), requestId));
    return;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Idempotency-Key, Last-Event-ID, If-None-Match, X-Local-User, X-Demo-Scenario",
    });
    res.end();
    return;
  }
  try {
    const user = owner(req);
    if (req.method === "GET" && url.pathname === "/health") {
      route = "health";
      respond(res, 200, {
        status: "ok",
        mode: production ? "production" : "local",
        simulation: !production,
      });
      return;
    }
    if (production && req.method === "POST" && url.pathname === "/reconcile") {
      for (const record of await store.pending())
        if (record.leaseUntilMs <= Date.now()) await enqueue(record.snapshot.id);
      respond(res, 200, { status: "ok" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks") {
      route = "tasks.create";
      if (!String(req.headers["content-type"]).startsWith("application/json"))
        throw error("INVALID_INPUT", "Send JSON using Content-Type: application/json.", 415);
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(key))
        throw error("INVALID_INPUT", "An Idempotency-Key of 8–100 characters is required.");
      const input = parseInput(await body(req));
      const selected = req.headers["x-demo-scenario"];
      const scenario =
        !production &&
        typeof selected === "string" &&
        [
          "success",
          "timeout",
          "no-evidence",
          "invalid-report",
          "slow-stream",
          "partial-report",
        ].includes(selected)
          ? selected
          : "success";
      const result = await Effect.runPromise(
        Effect.match(service.submit(input, user, key, scenario), {
          onFailure: (failure) => ({ ok: false as const, failure }),
          onSuccess: (task) => ({ ok: true as const, task }),
        }),
      );
      if (!result.ok) throw result.failure;
      taskId = result.task.id;
      reference = result.task.traceId;
      if (production && !terminal(result.task)) {
        try {
          await enqueue(taskId);
        } catch {
          console.log(JSON.stringify({ event: "queue.pending", taskId, reference, requestId }));
        }
      }
      respond(res, 202, result.task);
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasks") {
      route = "tasks.list";
      respond(
        res,
        200,
        (await store.recent(user)).map((task) => ({
          id: task.id,
          kind: task.input.kind,
          question: task.input.question,
          status: task.status,
          createdAt: task.createdAt,
        })),
      );
      return;
    }
    const recentMatch = /^\/tasks\/([a-f0-9-]{36})\/recent$/.exec(url.pathname);
    if (req.method === "PATCH" && recentMatch?.[1]) {
      route = "tasks.recent";
      if (!String(req.headers["content-type"]).startsWith("application/json"))
        throw error("INVALID_INPUT", "Send JSON using Content-Type: application/json.", 415);
      const value = await body(req);
      if (
        !value ||
        typeof value !== "object" ||
        !("visible" in value) ||
        typeof value.visible !== "boolean"
      )
        throw error("INVALID_INPUT", "Choose whether to show this recent note.");
      await store.setRecentVisibility(recentMatch[1], user, value.visible);
      res.writeHead(204);
      res.end();
      return;
    }
    const match = /^\/tasks\/([a-f0-9-]{36})(\/events)?$/.exec(url.pathname);
    if (req.method === "GET" && match?.[1]) {
      const id = match[1];
      route = match[2] ? "tasks.events" : "tasks.get";
      const record = await owned(id, user);
      taskId = id;
      reference = record.snapshot.traceId;
      if (!match[2]) {
        const snapshot = decodeSnapshot(id, record.snapshot);
        const tag = `"${id}-${snapshot.revision}"`;
        if (req.headers["if-none-match"] === tag) {
          res.writeHead(304, { ETag: tag, "Cache-Control": "private, no-cache" });
          res.end();
        } else {
          res.setHeader("ETag", tag);
          res.setHeader("Cache-Control", "private, no-cache");
          respond(res, 200, snapshot);
        }
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "private, no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.setTimeout(20_000, () => res.destroy());
      res.flushHeaders();
      let closed = false;
      let last = -1;
      let blocked = false;
      let latest: string | null = null;
      let blockedAt = 0;
      let terminalPending = false;
      let unsubscribe: (() => void) | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(stall);
        clearTimeout(lifetime);
        unsubscribe?.();
        req.off("aborted", close);
        res.off("close", close);
        res.off("error", close);
        res.off("drain", drain);
        res.end();
      };
      const write = (frame: string) => {
        if (closed) return;
        if (blocked) {
          latest = frame;
          return;
        }
        if (!res.write(frame)) {
          blocked = true;
          blockedAt = Date.now();
        }
      };
      const drain = () => {
        blocked = false;
        const frame = latest;
        latest = null;
        if (frame) write(frame);
        if (terminalPending && !blocked && !latest) close();
      };
      const publish = (value: unknown) => {
        if (closed) return;
        let task;
        try {
          task = decodeSnapshot(id, value);
        } catch {
          close();
          return;
        }
        if (task.revision <= last) return;
        last = task.revision;
        write(`id: ${task.revision}\nevent: snapshot\ndata: ${JSON.stringify(task)}\n\n`);
        if (terminal(task)) {
          if (latest) terminalPending = true;
          else close();
        }
      };
      const heartbeat = setInterval(() => {
        if (!blocked) write(": keep-alive\n\n");
      }, 10_000);
      const stall = setInterval(() => {
        if (blocked && Date.now() - blockedAt > 20_000) close();
      }, 5_000);
      const lifetime = setTimeout(close, STREAM_LIFETIME_MS);
      req.on("aborted", close);
      res.on("close", close);
      res.on("error", close);
      res.on("drain", drain);
      write("retry: 3000\n\n");
      publish(record.snapshot);
      if (!closed) {
        unsubscribe = store.db
          .collection("tasks")
          .doc(id)
          .onSnapshot((snap) => {
            const current = snap.data() as typeof record | undefined;
            if (!current || current.owner !== user) {
              close();
              return;
            }
            publish(current.snapshot);
          }, close);
        if (closed) unsubscribe();
      }
      return;
    }
    throw error("NOT_FOUND", "This endpoint does not exist.", 404);
  } catch (cause) {
    const failure =
      cause instanceof AppError
        ? cause
        : error(
            "INTERNAL",
            "The request could not be completed. Use the reference if it persists.",
            500,
            true,
          );
    if (!res.headersSent) respond(res, failure.status, publicError(failure, requestId));
    else res.end();
  }
});
server.listen(port, production ? "0.0.0.0" : "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      service: "api",
      url: `http://localhost:${port}`,
      mode: production ? "production" : "local",
      simulation: !production,
    }),
  ),
);
process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
