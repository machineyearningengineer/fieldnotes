import { spawnSync } from "node:child_process";
const project = "fieldnotes-valyu-20261102";
const sa = (name) => `${name}@${project}.iam.gserviceaccount.com`;
function run(args) {
  const r = spawnSync("gcloud", args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`gcloud ${args[0]} failed`);
}
for (const [name, role] of [
  ["fieldnotes-api", "roles/datastore.user"],
  ["fieldnotes-api", "roles/cloudtasks.enqueuer"],
  ["fieldnotes-worker", "roles/datastore.user"],
  ["fieldnotes-worker", "roles/aiplatform.user"],
])
  run([
    "projects",
    "add-iam-policy-binding",
    project,
    `--member=serviceAccount:${sa(name)}`,
    `--role=${role}`,
    "--quiet",
    "--format=none",
  ]);
run([
  "iam",
  "service-accounts",
  "add-iam-policy-binding",
  sa("fieldnotes-queue"),
  `--project=${project}`,
  `--member=serviceAccount:${sa("fieldnotes-api")}`,
  "--role=roles/iam.serviceAccountUser",
  "--quiet",
  "--format=none",
]);
if (
  spawnSync(
    "gcloud",
    [
      "iam",
      "workload-identity-pools",
      "describe",
      "fieldnotes-vercel",
      "--project=" + project,
      "--location=global",
    ],
    { stdio: "ignore" },
  ).status !== 0
)
  run([
    "iam",
    "workload-identity-pools",
    "create",
    "fieldnotes-vercel",
    `--project=${project}`,
    "--location=global",
    "--display-name=Fieldnotes Vercel",
    "--quiet",
    "--format=none",
  ]);
run([
  "iam",
  "workload-identity-pools",
  "providers",
  spawnSync(
    "gcloud",
    [
      "iam",
      "workload-identity-pools",
      "providers",
      "describe",
      "production",
      "--project=" + project,
      "--location=global",
      "--workload-identity-pool=fieldnotes-vercel",
    ],
    { stdio: "ignore" },
  ).status === 0
    ? "update-oidc"
    : "create-oidc",
  "production",
  `--project=${project}`,
  "--location=global",
  "--workload-identity-pool=fieldnotes-vercel",
  "--issuer-uri=https://oidc.vercel.com/fatherstretchmybandz",
  "--allowed-audiences=https://vercel.com/fatherstretchmybandz",
  "--attribute-mapping=google.subject=assertion.sub",
  "--attribute-condition=assertion.sub == 'owner:fatherstretchmybandz:project:fieldnotes-valyu:environment:production'",
  "--quiet",
  "--format=none",
]);
run([
  "iam",
  "service-accounts",
  "add-iam-policy-binding",
  sa("fieldnotes-vercel"),
  `--project=${project}`,
  "--member=principal://iam.googleapis.com/projects/371405901846/locations/global/workloadIdentityPools/fieldnotes-vercel/subject/owner:fatherstretchmybandz:project:fieldnotes-valyu:environment:production",
  "--role=roles/iam.workloadIdentityUser",
  "--quiet",
  "--format=none",
]);
run([
  "tasks",
  "queues",
  spawnSync(
    "gcloud",
    ["tasks", "queues", "describe", "research", "--project=" + project, "--location=europe-west2"],
    { stdio: "ignore" },
  ).status === 0
    ? "update"
    : "create",
  "research",
  `--project=${project}`,
  "--location=europe-west2",
  "--max-concurrent-dispatches=1",
  "--max-dispatches-per-second=1",
  "--max-attempts=3",
  "--min-backoff=10s",
  "--max-backoff=60s",
  "--max-retry-duration=600s",
  "--quiet",
  "--format=none",
]);
run([
  "secrets",
  "add-iam-policy-binding",
  "valyu-api-key",
  `--project=${project}`,
  `--member=serviceAccount:${sa("fieldnotes-worker")}`,
  "--role=roles/secretmanager.secretAccessor",
  "--quiet",
  "--format=none",
]);
run([
  "projects",
  "add-iam-policy-binding",
  project,
  `--member=serviceAccount:${sa("fieldnotes-worker")}`,
  "--role=roles/cloudtrace.agent",
  "--quiet",
  "--format=none",
]);
