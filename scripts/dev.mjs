import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { exportLocalSnapshot, localImport } from "./emulator-state.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const state = path.join(root, ".local");
await mkdir(path.join(state, "firestore"), { recursive: true });
const workspaceId = createHash("sha256").update(root).digest("hex").slice(0, 8);
const project = `valyu-${workspaceId}`;
const lockPath = path.join(state, "dev.lock");
try {
  const lock = await open(lockPath, "wx");
  await lock.writeFile(String(process.pid));
  await lock.close();
} catch {
  const previous = Number(await readFile(lockPath, "utf8"));
  let alive = false;
  try {
    process.kill(previous, 0);
    alive = true;
  } catch {}
  if (alive) {
    const runtime = JSON.parse(await readFile(path.join(state, "runtime.json"), "utf8"));
    console.log(`This worktree already has a dev runtime: ${runtime.web}`);
    process.exit(0);
  }
  await rm(lockPath);
  const lock = await open(lockPath, "wx");
  await lock.writeFile(String(process.pid));
  await lock.close();
}
const children = [];
let stopping = false;
let stopPromise;
let composeStarted = false;
let emulatorReady = false;
const command = (program, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)),
    );
  });
const free = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
// A stopped supervisor can leave an unexported emulator alive. Never let Compose replace it.
const retained = execFileSync(
  "docker",
  [
    "ps",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    "label=com.docker.compose.service=firestore",
    "--format",
    "{{.ID}}",
  ],
  { encoding: "utf8" },
).trim();
if (retained)
  throw new Error(
    "This checkout has a retained Firestore emulator. Export its live data before restarting; no container was replaced.",
  );

let base = 24000 + (parseInt(workspaceId.slice(0, 4), 16) % 3000) * 8;
for (let attempt = 0; attempt < 10; attempt++) {
  if ((await Promise.all([0, 1, 2, 3].map((offset) => free(base + offset)))).every(Boolean)) break;
  base += 4;
  if (attempt === 9)
    throw new Error("No free local port block. Set up a separate runtime before starting.");
}
const imported = await localImport(path.join(state, "firestore"));
const env = {
  ...process.env,
  APP_MODE: "local",
  RUNTIME_ID: workspaceId,
  FIRESTORE_PORT: String(base + 3),
  FIRESTORE_IMPORT: imported,
  FIRESTORE_EMULATOR_HOST: `127.0.0.1:${base + 3}`,
  API_PORT: String(base + 1),
  WORKER_PORT: String(base + 2),
  API_ORIGIN: `http://127.0.0.1:${base + 1}`,
  WEB_ORIGIN: `http://127.0.0.1:${base}`,
  NEXT_TELEMETRY_DISABLED: "1",
  METADATA_SERVER_DETECTION: "none",
};
const runtime = {
  workspaceId,
  project,
  pid: process.pid,
  root,
  web: env.WEB_ORIGIN,
  api: env.API_ORIGIN,
  worker: `http://127.0.0.1:${base + 2}`,
  firestore: env.FIRESTORE_EMULATOR_HOST,
  mode: "local",
  startedAt: new Date().toISOString(),
};
function stop() {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    for (const child of children) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
    await Promise.all(
      children.map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            const timeout = setTimeout(resolve, 1500);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          }),
      ),
    );
    for (const child of children) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
    if (emulatorReady) await exportLocalSnapshot(runtime.firestore, path.join(state, "firestore"));
    if (composeStarted) {
      await command("docker", ["compose", "-p", project, "stop", "--timeout", "20", "firestore"], {
        env,
      });
    }
    await rm(lockPath, { force: true });
    await writeFile(
      path.join(state, "runtime.json"),
      JSON.stringify({ ...runtime, stopped: true }, null, 2),
    );
  })();
  return stopPromise;
}
const shutdown = () => {
  void stop()
    .then(() => process.exit(0))
    .catch((cause) => {
      console.error("Local shutdown failed:", cause.message);
      process.exit(1);
    });
};
// Keep handlers installed: repeated signals must await the same export, not exit early.
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
try {
  await writeFile(path.join(state, "runtime.json"), JSON.stringify(runtime, null, 2));
  composeStarted = true;
  await command(
    "docker",
    ["compose", "-p", project, "up", "-d", "--wait", "--wait-timeout", "90", "firestore"],
    { env },
  );
  if (stopping) {
    await stop();
    process.exit(0);
  }
  emulatorReady = true;
  function start(name, script, args = [], cwd = root) {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env,
      stdio: "inherit",
      detached: true,
    });
    children.push(child);
    child.on("exit", (code) => {
      if (!stopping) {
        console.error(`${name} stopped (${code}). Stopping this worktree runtime.`);
        void stop().then(() => process.exit(code || 1));
      }
    });
    child.on("error", (cause) => console.error(name, cause));
  }
  start("API", "--watch", ["apps/api/src/main.ts"]);
  start("worker", "--watch", ["apps/worker/src/main.ts"]);
  start(
    "web",
    "node_modules/next/dist/bin/next",
    ["dev", "--port", String(base), "--hostname", "127.0.0.1"],
    path.join(root, "apps/web"),
  );
  console.log(
    `\nFIELDNOTES local simulation\nBrowser: ${runtime.web}\nAPI: ${runtime.api}\nWorkspace: ${workspaceId}\nCompose project: ${project}\nNo research keys or paid calls. Ctrl-C stops only this runtime.\n`,
  );
} catch (cause) {
  console.error(cause.message);
  await stop();
  process.exit(1);
}
