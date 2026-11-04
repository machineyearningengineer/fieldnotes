/** Configure the linked Vercel project without putting secret values in command arguments or logs. */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const state = JSON.parse(await readFile(".scratch/deployment-state.json", "utf8"));
if (!state.api || state.projectId !== "fieldnotes-valyu-20261102")
  throw new Error("Deploy and verify the isolated backend first.");
function run(args, input) {
  const result = spawnSync("vercel", args, {
    input,
    encoding: "utf8",
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`Vercel ${args[0]} failed`);
}
await mkdir(".local/credentials", { recursive: true, mode: 0o700 });
let credentials;
try {
  credentials = JSON.parse(await readFile(".local/credentials/demo.json", "utf8"));
} catch (cause) {
  if (cause.code !== "ENOENT") throw cause;
  credentials = {
    accessCode: randomBytes(12).toString("hex"),
    sessionSecret: randomBytes(32).toString("hex"),
  };
  await writeFile(".local/credentials/demo.json", JSON.stringify(credentials), { mode: 0o600 });
  await writeFile(".local/credentials/demo-access-code", credentials.accessCode, { mode: 0o600 });
}
const values = {
  NEXT_PUBLIC_APP_MODE: "production",
  API_ORIGIN: state.api,
  GCP_FEDERATION_AUDIENCE:
    "//iam.googleapis.com/projects/371405901846/locations/global/workloadIdentityPools/fieldnotes-vercel/providers/production",
  GCP_SERVICE_ACCOUNT_EMAIL: "fieldnotes-vercel@fieldnotes-valyu-20261102.iam.gserviceaccount.com",
  SESSION_SECRET: credentials.sessionSecret,
  DEMO_ACCESS_CODE: credentials.accessCode,
};
for (const [key, value] of Object.entries(values))
  run(
    [
      "env",
      "add",
      key,
      "production",
      "--yes",
      "--force",
      ...(key === "SESSION_SECRET" || key === "DEMO_ACCESS_CODE"
        ? ["--sensitive"]
        : ["--no-sensitive"]),
    ],
    value,
  );
run(["deploy", "--prod", "--yes", "--archive=tgz"]);
