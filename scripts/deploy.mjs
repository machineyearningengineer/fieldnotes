/** Deploy the reviewed backend image. Uses the operator's gcloud identity; no service-account keys. */
import { spawnSync } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
const project = "fieldnotes-valyu-20261102",
  region = "europe-west2";
const state = JSON.parse(await readFile(".scratch/deployment-state.json", "utf8"));
if (state.projectId !== project || !state.budgetReady)
  throw new Error("Verify project and warning budget first.");
if (!process.argv.includes("--deploy"))
  throw new Error("Use node scripts/deploy.mjs --deploy after review and checks.");
function run(bin, args, capture = false) {
  const r = spawnSync(bin, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (r.status !== 0) throw new Error(`${bin} ${args[0]} failed`);
  return r.stdout?.trim();
}
const sa = (name) => `fieldnotes-${name}@${project}.iam.gserviceaccount.com`;
const image = `${region}-docker.pkg.dev/${project}/fieldnotes/backend:${process.env.IMAGE_TAG ?? "launch"}`;
run("docker", [
  "buildx",
  "build",
  "--platform",
  "linux/amd64",
  "--load",
  "-t",
  image,
  "-f",
  "infrastructure/Dockerfile",
  ".",
]);
run("docker", ["push", image]);
const repository = image.slice(0, image.lastIndexOf(":"));
const immutableImage = JSON.parse(
  run("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", image], true),
)?.find((digest) => digest.startsWith(repository + "@sha256:"));
if (!immutableImage) throw new Error("The pushed image has no matching immutable digest.");
function promote(service) {
  const revision = run(
    "gcloud",
    [
      "run",
      "services",
      "describe",
      service,
      "--project=" + project,
      "--region=" + region,
      "--format=value(status.latestCreatedRevisionName)",
    ],
    true,
  );
  const deployedImage = run(
    "gcloud",
    [
      "run",
      "revisions",
      "describe",
      revision,
      "--project=" + project,
      "--region=" + region,
      "--format=value(spec.containers[0].image)",
    ],
    true,
  );
  if (deployedImage !== immutableImage)
    throw new Error("Another deployment changed the latest revision; traffic was not changed.");
  // A previous rollback pins traffic. Creating a revision alone does not move that pin.
  run("gcloud", [
    "run",
    "services",
    "update-traffic",
    service,
    "--project=" + project,
    "--region=" + region,
    "--to-revisions=" + revision + "=100",
    "--quiet",
  ]);
  const traffic = JSON.parse(
    run(
      "gcloud",
      [
        "run",
        "services",
        "describe",
        service,
        "--project=" + project,
        "--region=" + region,
        "--format=json(status.traffic)",
      ],
      true,
    ),
  ).status.traffic;
  const receiving = traffic.filter((entry) => entry.percent > 0);
  if (
    receiving.reduce((sum, entry) => sum + entry.percent, 0) !== 100 ||
    receiving.some((entry) => entry.revisionName !== revision)
  )
    throw new Error("Deployment traffic does not match the reviewed revision.");
}
// The owner/date query needs this production composite index; the emulator does not enforce it.
const readIndexes = () =>
  JSON.parse(
    run(
      "gcloud",
      ["firestore", "indexes", "composite", "list", "--project=" + project, "--format=json"],
      true,
    ),
  );
const matchesIndex = (index) =>
  index.name?.includes("/collectionGroups/tasks/") &&
  index.queryScope === "COLLECTION" &&
  index.fields?.[0]?.fieldPath === "owner" &&
  index.fields[0].order === "ASCENDING" &&
  index.fields?.[1]?.fieldPath === "snapshot.createdAt" &&
  index.fields[1].order === "DESCENDING";
if (!readIndexes().some(matchesIndex))
  run("gcloud", [
    "firestore",
    "indexes",
    "composite",
    "create",
    "--project=" + project,
    "--collection-group=tasks",
    "--query-scope=collection",
    "--field-config=field-path=owner,order=ascending",
    "--field-config=field-path=snapshot.createdAt,order=descending",
    "--quiet",
    "--async",
  ]);
for (let attempt = 0; ; attempt++) {
  const index = readIndexes().find(matchesIndex);
  if (index?.state === "READY") break;
  if (attempt >= 60 || index?.state === "NEEDS_REPAIR")
    throw new Error("Recent-task index is not ready; deployment stopped.");
  console.log("Waiting for the recent-task index...");
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
const common = [
  "--project=" + project,
  "--region=" + region,
  "--image=" + immutableImage,
  "--no-allow-unauthenticated",
  "--min=0",
  "--max=1",
  "--cpu=1",
  "--memory=512Mi",
  "--no-cpu-boost",
  "--quiet",
];
run("gcloud", [
  "run",
  "deploy",
  "fieldnotes-worker",
  ...common,
  "--service-account=" + sa("worker"),
  "--concurrency=1",
  "--timeout=240s",
  "--command=node",
  "--args=apps/worker/src/main.ts",
  "--set-env-vars=APP_MODE=production,GOOGLE_CLOUD_PROJECT=" +
    project +
    ",CLOUD_REGION=" +
    region +
    ",MODEL_LOCATION=eu,MODEL_ID=gemini-3.8-flash",
  "--set-secrets=VALYU_API_KEY=valyu-api-key:1",
]);
promote("fieldnotes-worker");
const worker = run(
  "gcloud",
  [
    "run",
    "services",
    "describe",
    "fieldnotes-worker",
    "--project=" + project,
    "--region=" + region,
    "--format=value(status.url)",
  ],
  true,
);
run("gcloud", [
  "run",
  "services",
  "add-iam-policy-binding",
  "fieldnotes-worker",
  "--project=" + project,
  "--region=" + region,
  "--member=serviceAccount:" + sa("queue"),
  "--role=roles/run.invoker",
  "--quiet",
  "--format=none",
]);
run("gcloud", [
  "run",
  "deploy",
  "fieldnotes-api",
  ...common,
  "--service-account=" + sa("api"),
  "--concurrency=16",
  "--timeout=70s",
  "--set-env-vars=APP_MODE=production,GOOGLE_CLOUD_PROJECT=" +
    project +
    ",CLOUD_REGION=" +
    region +
    ",WORKER_URL=" +
    worker +
    ",QUEUE_SERVICE_ACCOUNT=" +
    sa("queue") +
    ",WEB_ORIGIN=https://fieldnotes-valyu.vercel.app",
]);
promote("fieldnotes-api");
const api = run(
  "gcloud",
  [
    "run",
    "services",
    "describe",
    "fieldnotes-api",
    "--project=" + project,
    "--region=" + region,
    "--format=value(status.url)",
  ],
  true,
);
for (const name of ["vercel", "api"])
  run("gcloud", [
    "run",
    "services",
    "add-iam-policy-binding",
    "fieldnotes-api",
    "--project=" + project,
    "--region=" + region,
    "--member=serviceAccount:" + sa(name),
    "--role=roles/run.invoker",
    "--quiet",
    "--format=none",
  ]);
await writeFile(
  ".scratch/deployment-state.json",
  JSON.stringify({ ...state, api, worker, image }, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify({ project, region, api, worker, image }));

// Periodic outbox reconciliation covers a crash between task acceptance and queue creation.
const job = [
  "scheduler",
  "jobs",
  "create",
  "http",
  "research-reconcile",
  "--project=" + project,
  "--location=" + region,
  "--schedule=* * * * *",
  "--uri=" + api + "/reconcile",
  "--http-method=POST",
  "--oidc-service-account-email=" + sa("api"),
  "--oidc-token-audience=" + api,
  "--headers=X-Research-Owner=reconciler,Content-Type=application/json",
  "--message-body={}",
  "--attempt-deadline=60s",
  "--quiet",
];
const existing = spawnSync(
  "gcloud",
  [
    "scheduler",
    "jobs",
    "describe",
    "research-reconcile",
    "--project=" + project,
    "--location=" + region,
  ],
  { stdio: "ignore" },
);
if (existing.status === 0) {
  job[2] = "update";
  const headerIndex = job.findIndex((value) => value.startsWith("--headers="));
  job[headerIndex] = job[headerIndex].replace("--headers=", "--update-headers=");
}
run("gcloud", job);
run("node", ["scripts/deploy-web.mjs"]);
