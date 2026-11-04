# Operations

The interview deployment is retired. These commands document the original setup and can incur charges if used to redeploy. Google project cleanup status is recorded in [the retirement record](retirement.md).

Detail for running, deploying, inspecting and maintaining this installation. The [README](../README.md) owns the overview, architecture, rationale and limits.

## Local runtime

Use Node 26+, pnpm 12 and Docker. No research keys or Google login are needed.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the printed browser URL. The runtime configuration is in `.local/runtime.json`. Each checkout gets separate ports, an emulator volume and a process lock; simultaneous worktrees have been verified. Ctrl-C stops only that checkout's processes and explicitly exports Firestore. The next start imports its checked snapshot. An export failure keeps the container running; an invalid import fails rather than silently starting empty. If a supervisor has stopped but its emulator remains alive, startup refuses to replace that retained data.

Local mode runs the real API, worker, Firestore adapter and browser connections with labelled synthetic providers. The scenario menu demonstrates success, timeout, no evidence, invalid citations, slow sections and an interrupted draft. It does not prove cloud identity, managed queue behaviour, scientific quality or billing.

## Checks

```sh
pnpm verify
node scenarios/local-reliability.ts
```

`verify` runs TypeScript, Oxlint, Oxfmt and the focused tests. Tests target costly failures (money, evidence admission, recovery, ordering); there is no coverage target or test retry. The emulator scenario covers concurrent idempotency, duplicate delivery, lease fencing and retained interrupted work, with zero paid calls.

The paid offline gate for checker and synthesis prompt, model or thinking changes:

```sh
node scripts/evaluate-claims.ts --run
```

It runs [evaluation/claim-support.json](../evaluation/claim-support.json) through the real checker with the operator's Google CLI login, one call per group, capped at USD0.05, and exits non-zero on any mismatch. It creates no task and writes nothing to Firestore.

Optional, no paid calls:

```sh
BASE_URL=http://127.0.0.1:YOUR_API_PORT TASK_ID=YOUR_SAVED_TASK_ID k6 run scenarios/read-load.js
node scenarios/reader.mjs http://localhost:YOUR_WEB_PORT
```

The k6 read smoke measures local reads only. The reader persona uses an isolated headless Chrome with mocked transport to check desktop/light and mobile/dark source panels, extraction formatting, refresh and cached offline reading; source navigation must add no task reads. Neither measures production capacity.

## Local API example

Use the local API origin printed by `pnpm dev`:

```sh
curl -X POST http://127.0.0.1:YOUR_API_PORT/tasks \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: example-discover-1' \
  -d '{"schemaVersion":1,"kind":"discover","question":"What evidence supports sodium-ion batteries for stationary grid storage?"}'

curl http://127.0.0.1:YOUR_API_PORT/tasks/TASK_ID
```

## Historical hosted evaluator flow

The original demo is offline. These commands require a new authorised deployment and credentials.

Save the separately supplied access code in an untracked local file, then:

```sh
node scripts/evaluate-hosted.mjs --code-file /path/to/access-code.txt --kind discover
node scripts/evaluate-hosted.mjs --kind compare
```

This creates a private 24-hour session under `.local/evaluator`, checks health and a typed invalid-input rejection, submits one real task per journey, verifies an idempotent replay, polls to completion and checks citation identities. Repeating a command in the same directory reuses that journey's idempotency key; `--out-dir` selects a separate session and therefore permits new paid research. After a network timeout, resume the retained request rather than creating a new key.

After both results finish, an isolated headless browser check reuses that session, opens citations and reloads both results. Start the local demo first so it can also demonstrate a real worker failure and its persistence (the local `invalid-report` synthetic provider, not a live outage):

```sh
LOCAL_RUNTIME_FILE=.local/runtime.json node scenarios/evaluator-browser.mjs .local/evaluator
```

For hosted curl, exchange the code at `/api/session`, keep the cookie, send the frontend origin in the login POST's `Origin` header, then call `/api/research/tasks`. Keep the code in a file or stdin, not shell history.

## Diagnostics

Every task has a 32-character support reference that joins saved events, usage, structured API and worker logs, and its Cloud Trace task trace. Each step (retrieve, write, finalize) and every provider call (search, generation, passage check) is a child span under that trace.

```sh
node scripts/inspect-task.ts FULL_LOCAL_REFERENCE
node scripts/inspect-cloud-task.mjs TASK_URL_OR_ID_OR_REFERENCE
node scripts/inspect-cloud-task.mjs TASK_URL_OR_ID_OR_REFERENCE --artifacts
```

The cloud command uses the operator's Google CLI login and accepts a task URL, ID or the displayed reference. It returns input, queries, sources, draft and final output, timings, logs and trace; `--artifacts` adds private raw Search results, saved draft lines, check results and claim associations. Its output contains research content; keep it in private context. Questions, excerpts and credentials are excluded from routine logs.

Adapter timings separate model stream opening, first chunk, stream completion, passage-check time, first verified section, artifact writes and block saves. These intervals overlap; do not sum them.

## Launch allowance

Each accepted task reserves USD0.10 of the USD1.50 lifetime allowance. Nothing is refunded automatically. After tasks are terminal, release unused allocation with:

```sh
node scripts/reconcile-launch.mjs          # dry run
node scripts/reconcile-launch.mjs --apply
```

It uses recorded costs for settled receipts, keeps full reservations for uncertain calls, follows Firestore page tokens, requires the inventory to match the ledger count, and commits only under a ledger update-time precondition.

## Deployment

Sign in with `gcloud auth login` and `vercel login`, place the supplied key in the ignored `.local/credentials/valyu-key` file, then:

```sh
node scripts/bootstrap-project.mjs
node scripts/deploy.mjs --deploy
```

The bootstrap selects the sole open billing account (or `BILLING_ACCOUNT_ID` when there is a choice), creates the warning budget before any deployment and preserves existing state. `scripts/bootstrap-identity.mjs` records service identities, project roles, the exact Vercel federation subject, the private queue (three attempts, 10–60s backoff) and the worker-only secret permission.

`scripts/deploy.mjs --deploy` builds and pushes the backend image from `infrastructure/Dockerfile`, waits for the recent-task index, deploys both private services from the immutable digest, verifies that 100% of traffic reaches the new revision, installs authenticated reconciliation and runs `scripts/deploy-web.mjs` for Vercel. Roll back by routing traffic to a previous revision with `gcloud run services update-traffic`. Operator state and credentials stay ignored under `.scratch` and `.local`. These commands are specific to this installation; do not point them at an unrelated project.

## Environment

| Where            | Variables                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Local supervisor | `APP_MODE`, `API_PORT`, `WORKER_PORT`, `WEB_ORIGIN`, `FIRESTORE_EMULATOR_HOST`                                                                 |
| Cloud Run (both) | `PORT` (from Cloud Run), `GOOGLE_CLOUD_PROJECT`, `CLOUD_REGION`, `APP_MODE=production`                                                         |
| API              | `WORKER_URL`, `QUEUE_SERVICE_ACCOUNT`                                                                                                          |
| Worker           | `MODEL_ID`, `MODEL_LOCATION`, `VALYU_API_KEY` (Secret Manager)                                                                                 |
| Vercel           | `NEXT_PUBLIC_APP_MODE`, `API_ORIGIN`, `GCP_FEDERATION_AUDIENCE`, `GCP_SERVICE_ACCOUNT_EMAIL`, `SESSION_SECRET`, `DEMO_ACCESS_CODE` (protected) |

The deployment scripts own the concrete values.

## Data retention

No Firestore TTL or automatic cleanup is configured. A snapshot's five-minute `expiresAt` is the research deadline, not retention. Preserve demo records through evaluation, then export or delete data and retire the isolated project. Rotating the session signing secret invalidates every session.
