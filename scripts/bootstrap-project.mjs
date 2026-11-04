/** Bootstrap this isolated installation through CLIs. Requires its owner's billing/deployment authority. */
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const project = "fieldnotes-valyu-20261102",
  region = "europe-west2";
function run(args) {
  return execFileSync("gcloud", [...args, "--quiet"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function exists(args) {
  return spawnSync("gcloud", [...args, "--quiet"], { stdio: "ignore" }).status === 0;
}
function ensure(describe, create) {
  if (!exists(describe)) run(create);
}
await mkdir(".scratch", { recursive: true, mode: 0o700 });
ensure(
  ["projects", "describe", project],
  ["projects", "create", project, "--name=Fieldnotes research"],
);
const number = JSON.parse(run(["projects", "describe", project, "--format=json"])).projectNumber;
const accounts = JSON.parse(
  run(["billing", "accounts", "list", "--filter=open=true", "--format=json"]),
);
const billing =
  process.env.BILLING_ACCOUNT_ID ??
  (accounts.length === 1 ? accounts[0].name.split("/").at(-1) : undefined);
if (!billing)
  throw new Error(
    "Select the authorised billing account using BILLING_ACCOUNT_ID. No account was linked.",
  );
run(["billing", "projects", "link", project, "--billing-account=" + billing]);
run(["services", "enable", "billingbudgets.googleapis.com", "--project=" + project]);
const budgets = JSON.parse(
  run(["billing", "budgets", "list", "--billing-account=" + billing, "--format=json"]),
);
let budget = budgets.find(
  (value) =>
    value.displayName === "Fieldnotes launch guard" &&
    value.budgetFilter?.projects?.includes("projects/" + number),
);
if (!budget)
  budget = JSON.parse(
    run([
      "billing",
      "budgets",
      "create",
      "--billing-account=" + billing,
      "--display-name=Fieldnotes launch guard",
      "--budget-amount=1",
      "--filter-projects=projects/" + number,
      "--threshold-rule=percent=0.25",
      "--threshold-rule=percent=0.5",
      "--threshold-rule=percent=0.8",
      "--threshold-rule=percent=1",
      "--project=" + project,
      "--format=json",
    ]),
  );
if (budget.amount?.specifiedAmount?.currencyCode !== "GBP")
  throw new Error("The warning budget currency differs from the authorised launch plan.");
let previous = {};
try {
  previous = JSON.parse(await readFile(".scratch/deployment-state.json", "utf8"));
} catch (cause) {
  if (cause.code !== "ENOENT") throw cause;
}
if (previous.projectId && previous.projectId !== project)
  throw new Error("Deployment state points at another project.");
await writeFile(
  ".scratch/deployment-state.json",
  JSON.stringify(
    {
      ...previous,
      projectId: project,
      projectNumber: number,
      region,
      modelLocation: "eu",
      model: "gemini-3.8-flash",
      budgetAlertNativeAmount: 1,
      budgetReady: true,
      budgetCurrency: "GBP",
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
run([
  "services",
  "enable",
  "run.googleapis.com",
  "cloudtasks.googleapis.com",
  "firestore.googleapis.com",
  "secretmanager.googleapis.com",
  "aiplatform.googleapis.com",
  "iamcredentials.googleapis.com",
  "sts.googleapis.com",
  "artifactregistry.googleapis.com",
  "cloudscheduler.googleapis.com",
  "cloudtrace.googleapis.com",
  "--project=" + project,
]);
ensure(
  ["firestore", "databases", "describe", "--project=" + project],
  [
    "firestore",
    "databases",
    "create",
    "--project=" + project,
    "--location=" + region,
    "--type=firestore-native",
  ],
);
ensure(
  [
    "artifacts",
    "repositories",
    "describe",
    "fieldnotes",
    "--project=" + project,
    "--location=" + region,
  ],
  [
    "artifacts",
    "repositories",
    "create",
    "fieldnotes",
    "--project=" + project,
    "--location=" + region,
    "--repository-format=docker",
  ],
);
for (const name of ["api", "worker", "queue", "vercel"])
  ensure(
    [
      "iam",
      "service-accounts",
      "describe",
      `fieldnotes-${name}@${project}.iam.gserviceaccount.com`,
      "--project=" + project,
    ],
    ["iam", "service-accounts", "create", "fieldnotes-" + name, "--project=" + project],
  );
ensure(
  ["secrets", "describe", "valyu-api-key", "--project=" + project],
  [
    "secrets",
    "create",
    "valyu-api-key",
    "--project=" + project,
    "--replication-policy=user-managed",
    "--locations=" + region,
  ],
);
if (
  !exists([
    "secrets",
    "versions",
    "describe",
    "1",
    "--secret=valyu-api-key",
    "--project=" + project,
  ])
)
  run([
    "secrets",
    "versions",
    "add",
    "valyu-api-key",
    "--project=" + project,
    "--data-file=.local/credentials/valyu-key",
  ]);
const identity = spawnSync("node", ["scripts/bootstrap-identity.mjs"], { stdio: "inherit" });
if (identity.status !== 0) throw new Error("Identity setup failed");
run(["auth", "configure-docker", region + "-docker.pkg.dev"]);
const v = (args) => {
  const result = spawnSync("vercel", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Vercel configuration failed");
};
if (
  spawnSync("vercel", ["project", "inspect", "fieldnotes-valyu"], { stdio: "ignore" }).status !== 0
)
  v(["project", "add", "fieldnotes-valyu", "--non-interactive"]);
v(["link", "--project", "fieldnotes-valyu", "--yes"]);
const settings = {
  rootDirectory: "apps/web",
  framework: "nextjs",
  buildCommand: "pnpm build",
  installCommand: "pnpm install --frozen-lockfile",
  nodeVersion: "26.x",
  oidcTokenConfig: { enabled: true },
  ssoProtection: null,
};
await writeFile(".scratch/vercel-settings.json", JSON.stringify(settings));
v([
  "api",
  "/v9/projects/fieldnotes-valyu",
  "-X",
  "PATCH",
  "--input",
  ".scratch/vercel-settings.json",
  "--silent",
]);
console.log(JSON.stringify({ project, region, budgetReady: true, readyForDeploy: true }));
