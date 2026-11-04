# Fieldnotes

A scientific question, the work behind an answer, and enough context to decide what to read next. Discover explores one question. Compare examines two named alternatives without requiring a winner.

The hosted research demo is retired following the interview. Run it locally with synthetic providers using the commands below; saved reports, screenshots and deployment evidence remain in this repository.

[Read the interview guide](https://fieldnotes-interview-pocket-owen.milkandhenny.chatgpt.site) for the request lifecycle, reliability rules, evidence checks, architecture trade-offs and known gaps. Its standalone source is [docs/interview-guide/index.html](docs/interview-guide/index.html); open that file in a browser without installing dependencies.

![The deployed Fieldnotes reading view](examples/fieldnotes.png)

I imagined a researcher doing an initial scan of an unfamiliar question: someone who needs a defensible next paper to read and an honest account of what the retrieved evidence does not settle, not an exhaustive review. The two domain features serve that. **Source cards** show the scientific metadata and the retained excerpt behind every citation, so a claim can be checked without leaving the page. The **search trail** shows exactly what was searched, so a gap can be judged as a gap in retrieval rather than in the literature. Every finished result also states its **outcome**: answered, partly answered or not directly answered.

## Run locally

Use Node 26+, pnpm 12 and Docker. No research keys or Google login are needed; local mode uses labelled synthetic providers with the real API, worker and Firestore emulator.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
node scenarios/local-reliability.ts
```

Example API use against the local API origin printed by `pnpm dev`:

```sh
curl -X POST http://127.0.0.1:YOUR_API_PORT/tasks \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: example-discover-1' \
  -d '{"schemaVersion":1,"kind":"discover","question":"What evidence supports sodium-ion batteries for stationary grid storage?"}'

curl http://127.0.0.1:YOUR_API_PORT/tasks/TASK_ID
```

Historical hosted evaluator commands (the demo is retired; these require a new deployment and access code):

```sh
node scripts/evaluate-hosted.mjs --code-file /path/to/access-code.txt --kind discover
node scripts/evaluate-hosted.mjs --kind compare
```

Deployment, required environment variables, diagnostics, the allowance tool and data retention are in [docs/operations.md](docs/operations.md). In short: `node scripts/bootstrap-project.mjs` once, then `node scripts/deploy.mjs --deploy`. The worker needs `VALYU_API_KEY` from Secret Manager, `MODEL_ID` and `MODEL_LOCATION`; the API needs `WORKER_URL` and `QUEUE_SERVICE_ACCOUNT`; both need `GOOGLE_CLOUD_PROJECT` and `CLOUD_REGION`; Vercel needs `API_ORIGIN`, the federation audience and service account, `SESSION_SECRET` and `DEMO_ACCESS_CODE`.

## Architecture

```mermaid
flowchart LR
  Browser -->|session cookie| Vercel[Vercel: Next.js and BFF]
  Vercel -->|federated identity| API[Private Cloud Run API]
  API --> DB[(Firestore)]
  API --> Queue[Cloud Tasks]
  Scheduler[Cloud Scheduler: reconcile] --> API
  Queue -->|OIDC delivery| Worker[Private Cloud Run worker]
  Worker --> DB
  Worker --> Search[Valyu Search]
  Worker --> Model[Vertex Gemini]
  DB -->|revisioned snapshots| API
  API -->|SSE or conditional GET| Vercel
```

| Question in the brief  | Answer                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How HTTP is served     | Vercel serves the Next.js app and a backend-for-frontend that verifies the session and calls the private Cloud Run API with a federated Google identity. No Google key exists.                                  |
| How work is queued     | `POST /tasks` saves the task and an owner-scoped idempotency key, then enqueues it on Cloud Tasks and returns at once. A minute Cloud Scheduler reconciliation re-enqueues anything accepted but not delivered. |
| Where task state lives | Firestore. One task document owns its input, queries, sources, report blocks, usage, events, outcome and revision; the browser only displays a copy.                                                            |
| Larger artifacts       | Raw Search results, saved draft lines, check results and claim associations are private Firestore subcollection documents. Object storage is the next step if they grow.                                        |
| Secrets                | The Valyu key is in Secret Manager, injected only into the worker as `VALYU_API_KEY`; it never reaches the browser, prompts, Git or logs. Session secrets are protected Vercel values.                          |
| Model                  | Vertex `gemini-3.8-flash` (EU) through `@google/genai`, so synthesis stays in Google Cloud without another credential.                                                                                          |
| Valyu                  | The official `valyu-js` SDK, Search only; DeepResearch and Answer are not used.                                                                                                                                 |
| Deploy and update      | CLI scripts build an immutable image, deploy both private services, verify traffic reaches the new revision and deploy Vercel.                                                                                  |

Compute and Firestore run in `europe-west2` in an isolated project, with no GPU and no always-on instance.

### Failure model

The worker's guarantees reduce to three rules, each owned in one place.

1. **Every step saves its output before the next starts, and redelivery skips finished steps.** A task runs as retrieve, write and finalize. Retrieve saves the merged sources. Write saves the finished draft lines inside the model's ledger operation, each passage-check result as it returns, and the key of every published block; a redelivered task replays the saved draft without another model call, reuses saved checks and never duplicates a block. A draft interrupted mid-stream stays visible and fails rather than paying for a second generation.
2. **Every provider call goes through one ledger** ([ledger.ts](packages/research/src/ledger.ts)): reserve the allowance before the request, call, settle from the provider's receipt. An uncertain call keeps its full reservation.
3. **Every write carries the lease epoch**, so a stale worker cannot overwrite a newer one.

Retries belong to the queue. A rejection the provider confirms cost nothing (Google 429/503 before a stream opens, or a Valyu rate limit with a measured zero deduction) hands the task back to Cloud Tasks, which redelivers with 10–60s backoff; the step runner resumes. Uncertain charges, non-retryable errors, the five-minute deadline and the third attempt fail visibly, with sources and any draft retained.

| State               | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| queued              | Accepted; waiting for a worker                                  |
| running / searching | Gathering source material                                       |
| running / writing   | Publishing checked sections as they pass                        |
| running / checking  | Validating the assembled report                                 |
| succeeded           | Final report with `outcome`: answered, partial or unanswered    |
| failed              | Work stopped; `outcome: failed`; sources and any draft retained |

The browser shows server truth. Streaming fits this product because a report arrives as checked sections over 10–40 seconds: SSE pushes each saved revision as it lands without a polling delay, needs only one-way traffic, and works through the Vercel proxy. Polling remains the fallback because streams stall or close on mobile networks, proxies and sleeping tabs. Each SSE stream starts from the latest saved snapshot and revisions only move forwards; polling serves the same snapshot as a fallback, with jittered backoff and pauses in hidden or offline tabs. REST/JSON with a generated OpenAPI contract (`/openapi.json`) keeps the boundary inspectable; `schemaVersion: 1` is unchanged by additive fields such as `outcome`.

| Capability                                    | Owner                |
| --------------------------------------------- | -------------------- |
| HTTP, ownership, durable acceptance, SSE      | `apps/api`           |
| Queue delivery and worker composition         | `apps/worker`        |
| Reading, navigation, session gateway          | `apps/web`           |
| Schemas, limits, typed errors, OpenAPI        | `packages/contracts` |
| Steps, ledger, grounding                      | `packages/research`  |
| Firestore, Valyu, Vertex, synthetic providers | `packages/adapters`  |

## Retrieval and the one implemented technique

Discover makes one unrestricted primary search and one academic search for limitations and conflicting evidence. Compare makes one academic search per named alternative and one unrestricted comparison search. These are deterministic templates, run concurrently, not a planning-model call. Search uses `searchType: all`, three results per query, medium content and abstracts. Academic searches query exactly the five scholarly collections (arXiv, PubMed, bioRxiv, medRxiv, ChemRxiv) whose records can become findings. A live Compare limited to PubMed and arXiv found no lithium iron phosphate records at all; the wider set returned two or three papers per alternative at about USD0.0055 per search.

Sources keep the structured metadata Valyu returns (authors, dates, type, DOI and citation where present), query provenance and a bounded excerpt. Long documents keep question-focused windows rather than only their opening, with original offsets recorded and an omission marker that no passage may cross.

**The one implemented orchestration technique is claim-to-passage grounding.** Code builds a passage catalogue; the model writes each atomic claim and selects a source and passage ID; code attaches the passage and citation link. A separate, budgeted model call then checks every claim against its passage before it can appear. Partial, contradictory and insufficient support is withheld, and the same check records which planned parts of the question each claim actually answers. Scientific Compare and evidence answers may cite only research records (provider-classified papers, the scholarly collections above, or a DOI link); ordinary web pages stay visible in Sources but cannot become findings.

Before and after, from a real output: an earlier Compare paragraph cited general lithium-ion operating guidance for a sentence that also reported an LFP cooling experiment. A URL-only check accepted it, because the citation link was valid. With grounding, the checker marks that claim partial and it is withheld; the plain guidance claim from the same passage passes. Both are cases in the offline evaluation gate below, alongside a supplier figure presented as "proven", an overreach to another chemistry, an absence claim and a table value attributed to the neighbouring row. The full before/after outputs are in [examples](examples/README.md).

When checked claims exist but none answers the question, the result opens with a server-written "Not directly answered" statement and shows them only as related evidence. This is the current Compare example: the retrieved papers report sodium-ion cathode cycling but no comparison with LFP under grid conditions.

Changes to the checker or synthesis prompt, model or thinking settings are gated by an offline evaluation: ten reviewed claim-and-passage cases run through the real checker (`node scripts/evaluate-claims.ts --run`, under USD0.05). All ten passed on 2 November; a deliberately lax checker failed two. A coding agent selected and labelled the cases; they are not an independent scientific benchmark.

Further techniques remain proposals to evaluate against that set before adding: an adaptive follow-up search when a required part stays unanswered, source reranking and contradiction checks. The brief asks for at most one implemented technique, and a follow-up search would also need a second generation within the 12-operation limit.

## Limits and cost

| Limit                   | Current envelope                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Question / alternatives | 500 characters; two alternatives of 120 characters                                                    |
| Searches / sources      | At most three searches and eight sources                                                              |
| Task provider allowance | USD0.10, reserved before each operation; at most 12 operations                                        |
| Search                  | USD0.01 per request                                                                                   |
| Generation              | USD0.06; 48,000 input bytes; 3,500 output tokens                                                      |
| Passage check           | At most USD0.012; 768 output tokens (thinking counts against it)                                      |
| Lifetime demo allowance | USD1.50, USD0.10 per accepted task, unused allocation released by the reconcile tool                  |
| Admission               | Three active tasks; 100 per day                                                                       |
| Runtime                 | Five-minute task deadline; worker run at most three minutes; 60-second lease renewed every 15 seconds |
| Queue / compute         | One concurrent delivery; three attempts; one instance per service, zero minimum                       |

Per-task provider cost on the current examples: Discover USD0.0075 measured Search and USD0.0132 estimated model; Compare USD0.0128 and USD0.0121. Search deductions are measured per Valyu transaction. Model cost is estimated from reported tokens at the verified EU rates (USD0.825 per million input, USD4.125 per million output, through 31 December 2026; the adapter fails closed after that date). Model use (generation plus checks) exceeds retrieval for Discover, while Compare's three searches cost about as much as its model use; each passage check adds about USD0.001–0.002. Cloud Run, Firestore, Cloud Tasks, Scheduler, logs, traces and Vercel Hobby are shared costs with no per-task allocation, and no free credit is assumed. A GBP1 project budget warning exists; overall new spend is authorised up to GBP5.

**Per-task COGS is therefore partial.** The planned final step is nightly reconciliation against the Cloud Billing export to BigQuery: label each Vertex request with its task reference so model charges join exactly, replace token estimates with invoiced amounts, allocate Cloud Run, Firestore and Cloud Tasks charges by each task's recorded run time, writes and deliveries, and report the unallocated remainder separately. This is documented, not implemented.

Latency is variable and its bottleneck moves: the current Discover example (30.5s) waited 8.0s on one search and Compare (21.5s) 12.5s on another, while earlier runs were dominated by the model, and Gemini took up to 66 seconds to open a stream during one evening's degradation, which hit the 90-second write deadline. These are observed runs, not percentiles. [latency-profile.json](examples/latency-profile.json) records the measured samples.

## Scaling writeup

Use a measured baseline before multiplying it. At one task per minute and a 30-second worker run, about 0.5 tasks run at once; ten times that is about five, a hundred times about fifty. Those are planning examples, not measured capacity. Viewer load is separate: one stream per open tab can exceed worker concurrency by far.

| Pressure                  | 10x                                                                                | 100x                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Provider quotas and spend | Measure latency, 429s, deductions and tokens; raise queue rate only within budget  | Global quota and budget admission, per-tenant fairness, provider capacity agreements                            |
| Workers and queue age     | Raise Cloud Tasks concurrency and Cloud Run limits from measured run time          | Separate long and short work when queue age and step variance justify it; the step checkpoints already allow it |
| Database contention       | Profile the global admission and wallet transactions and writes per section        | Replace hot global counters with allocated admission; move large artifacts to object storage                    |
| Browser connections       | Measure active viewers, snapshot size, listener reads and reconnect storms         | Shared change fan-out and bounded stream gateways instead of one listener per browser                           |
| Polling and caches        | Conditional GET saves bytes, not the read that finds the revision                  | Cache immutable authorised artifacts by owner, task and revision                                                |
| Operations                | Alerts on queue age, errors and unknown reservations; per-step spans already exist | Tested backup and restore, retention and regional recovery; leases are not disaster recovery                    |

What breaks first is provider latency and the single worker instance: one slow model stream occupies the only delivery slot. Measure queue age, time to first checked section, provider errors, unknown reservations and cost per useful result before scaling anything. Load testing is planned with synthetic providers (k6 for admission, viewers and reconnects) and has not been run.

## Known limits

- Per-task COGS is partial, as above.
- Retrieval is two or three templated searches, not a literature review. A question whose retrieved records only partly answer it gets a partial result; supported but off-question findings give a labelled unanswered result; and when no checked claim survives, or a Compare retrieves no research records, the task fails visibly with its sources retained.
- The checker and the coverage plan are model judgements. They catch the evaluated failure kinds but prove neither completeness nor scientific truth.
- Whether an answer is an explanation or an evidence assessment is decided by the model's plan, so a scientific Discover question framed as an explanation can still cite attributed web accounts.
- Sessions are anonymous 24-hour demo sessions without recovery or deletion; reports are not deleted automatically.
- Provider outages surface as visible failures: Valyu's academic search was unavailable for about 15 minutes and Gemini was slow for part of 2 November.

## Design

The app owns the adapted Looseleaf paper components and its MIT notice. Source Sans 3 is the interface face, Source Serif 4 the reading face, Kevin Sans only for accents. Appearance cycles System, Light and Dark with separately designed palettes whose selected contrast pairs were measured. Keyboard focus, Escape, mobile sheets and browser history are part of the interaction checks. Markdown download and print share the final report. The interface prioritises readable reports, explicit state and inspectable evidence.

## Evidence and scope

The assignment required a GCP asynchronous research backend, a Vercel frontend, Valyu Search, durable state, bounded costs, a scaling writeup and at most one implemented research improvement. The original employer brief and correspondence are retained privately and excluded from the public edition. Private review records document each change’s separate read-only Codex review and findings; they are excluded from the public edition. Earlier work was built by Codex (same-provider review); the step runner, ledger, queue retries, outcome, tracing, offline gate and the evening's fixes on 2 November were built by Claude at Owen's direction and reviewed by Codex. Examples and the [release record](examples/release.json) record actual outputs, revisions, costs and remaining checks. Original contributions are provided for recruitment evaluation under [LICENSE](LICENSE); the archive excludes secrets and private career material.
