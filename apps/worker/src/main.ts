import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { terminal } from "@valyu-research/contracts";
import { ResearchService } from "@valyu-research/research";
import { FixtureProviders, FirestoreTaskStore, localDatabase } from "@valyu-research/adapters";
import { productionDatabase, writeTaskTrace } from "@valyu-research/adapters/cloud";
const production = process.env.APP_MODE === "production";
if (!production && process.env.APP_MODE !== "local") throw new Error("Set APP_MODE explicitly.");
const store = new FirestoreTaskStore(production ? productionDatabase() : localDatabase());
const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 23121);
const workerId = randomUUID();
const inFlight = new Set<string>();
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/run") {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    let text = "";
    for await (const data of req) {
      text += data.toString();
      if (text.length > 256) throw new Error("oversize");
    }
    const value: unknown = JSON.parse(text);
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      typeof value.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.id)
    )
      throw new Error("invalid task");
    const runId = randomUUID();
    const providers = production
      ? new (await import("@valyu-research/adapters/live")).LiveProviders({
          apiKey: process.env.VALYU_API_KEY ?? "",
          project: process.env.GOOGLE_CLOUD_PROJECT ?? "",
          location: process.env.MODEL_LOCATION ?? "eu",
          model: process.env.MODEL_ID ?? "gemini-3.8-flash",
          saveArtifact: async (name, data) => {
            if (!/^[a-zA-Z0-9_-]{1,150}$/.test(name)) throw new Error("Invalid artifact ID");
            await store.db
              .collection("tasks")
              .doc(value.id as string)
              .collection("artifacts")
              .doc(`${runId}-${name}`)
              .set({ runId, ...data });
          },
        })
      : new FixtureProviders();
    const service = new ResearchService(store, providers, (value) =>
      console.log(JSON.stringify({ service: "worker", runId, ...value })),
    );
    await service.run(value.id, workerId);
    const final = await store.get(value.id);
    if (production && final && terminal(final.snapshot)) {
      try {
        await writeTaskTrace(
          final.snapshot,
          final.snapshot.createdAt,
          final.snapshot.updatedAt,
          final.spans ?? [],
        );
      } catch {
        console.log(
          JSON.stringify({
            event: "trace.export_failed",
            taskId: value.id,
            reference: final.snapshot.traceId,
          }),
        );
      }
    }
    if (final && !terminal(final.snapshot)) {
      res.writeHead(503);
      res.end("Research still active");
      return;
    }
    res.writeHead(200);
    res.end("ok");
  } catch {
    console.log(
      JSON.stringify({ service: "worker", event: "delivery.failed", requestId: randomUUID() }),
    );
    res.writeHead(503);
    res.end("Worker delivery failed");
  }
});
const dispatcher = setInterval(() => {
  if (production) return;
  void store
    .pending()
    .then((records) => {
      for (const record of records) {
        const id = record.snapshot.id;
        if (
          inFlight.has(id) ||
          record.leaseUntilMs > Date.now() ||
          terminal(record.snapshot) ||
          inFlight.size >= 3
        )
          continue;
        inFlight.add(id);
        void fetch(`http://127.0.0.1:${port}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          signal: AbortSignal.timeout(240_000),
        })
          .then(async (response) => {
            if (response.ok) await store.markDelivered(id);
          })
          .catch(() => {})
          .finally(() => inFlight.delete(id));
      }
    })
    .catch(() => {});
}, 800);
server.listen(port, production ? "0.0.0.0" : "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      service: "worker",
      url: `http://localhost:${port}`,
      mode: production ? "production" : "local",
      simulation: !production,
    }),
  ),
);
const stop = () => {
  clearInterval(dispatcher);
  server.close();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
