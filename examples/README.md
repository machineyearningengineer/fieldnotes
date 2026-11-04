# Research examples and evaluation

The current [Discover](discover.md) and [Compare](compare.md) reports were generated on the deployed service (commit c01f11d) through the documented evaluator flow, with an idempotent replay per journey that returned the same task ID. Their JSON snapshots keep the request, generated queries, source metadata and excerpts, report blocks, timings, usage, outcome and support reference, and contain no provider key or session cookie. [Discover PDF](discover.pdf), [Compare PDF](compare.pdf) and the [app preview](fieldnotes.png) were captured in an isolated headless Chrome. Outputs from the earlier release are kept unchanged in [earlier-release](earlier-release/) so their limitations stay visible.

| Current case | Outcome                                                                     | Task acceptance | Total elapsed | First block after acceptance | Measured Search | Estimated model |
| ------------ | --------------------------------------------------------------------------- | --------------: | ------------: | ---------------------------: | --------------: | --------------: |
| Discover     | Answered; 4 draft claims withheld                                           |          0.687s |        30.48s |                       27.03s |       $0.007500 |       $0.013193 |
| Compare      | Not directly answered; one checked related finding; 3 draft claims withheld |          1.175s |        21.46s |                       20.86s |       $0.012813 |       $0.012141 |

These are single observed runs, not latency percentiles. Discover's first search took 8.0s and Compare's comparison search 12.5s that evening; the first block also waits for its passage check.

The Compare outcome is deliberate. The checked research records in this run contain sodium-ion cathode cycling results but no comparison of sodium-ion and lithium iron phosphate under grid-storage conditions. Instead of failing or padding the answer with background, the result says so first, shows the checked finding as related evidence, and lists the unanswered parts of the question. When a section does answer the question, earlier background is withheld as before.

## Changes since the earlier release

Same-day live runs on the earlier release exposed four problems, each fixed and separately reviewed:

| Observed failure                                                                                                                                         | Change                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Compare's academic searches were limited to PubMed and arXiv and found no lithium iron phosphate records; the research-record rule then left no evidence | Academic searches query the five scholarly collections the rule admits (arXiv, PubMed, bioRxiv, medRxiv, ChemRxiv) |
| Discover's web search found Frontiers and MDPI journal articles labelled as websites, so every claim was rejected                                        | A doi.org URL or a DOI in the URL path counts as a research record; the model is told which sources it may cite    |
| A checked but off-question finding made the whole task fail                                                                                              | The labelled "not directly answered" result described above                                                        |
| One malformed model line discarded already checked work                                                                                                  | A malformed section after the coverage plan is withheld and reported under Evidence limits                         |

Passage checks also overlap now, at most two at once, while sections still publish in order. Valyu's academic search was briefly unavailable during this work (22:05–22:20 UTC); affected tasks failed visibly with uncertain search charges retained.

## Earlier release: what changed

The `before-review` snapshots completed technically but blurred sodium-ion with sodium-sulphur, or lithium iron phosphate with lithium-ion generally. The `flash-lite` snapshots show the next instruction revision. The current reports use the stronger pinned model within the unchanged task allowance.

The one implemented orchestration improvement is passage traceability. A URL-only check accepts a fabricated claim if its URL exists. The focused grounding test contrasts that with rejecting an invented passage ID, and checks that the selected source text is retained exactly. Deliberately bypassing passage-ID association makes the test fail. Citation URLs and quoted passages are supplied by code rather than copied by the model.

Agent review used the associations to locate unsupported family-level generalisations. The corrected Compare report separates general lithium-ion findings from a retrieved LFP-specific cooling study and explicitly declines a head-to-head ranking. Discover distinguishes insertion-based sodium-ion cells from conversion-based sodium chemistries. Both preserve gaps rather than claiming deployment-level evidence that the limited search did not find.

## What is verified, and what remains judgement

| Dimension             | Observation                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Task correctness      | Both kinds reached final state through the live API/queue/worker; saved blocks, usage and references persisted                                  |
| Citation identity     | Every emitted citation belongs to a retained source; IDs are generated from those source records                                                |
| Passage association   | Each model claim selects a supplied passage; invalid IDs and multi-paragraph/linked claim text are rejected                                     |
| Comparability         | Current Compare states that the checked records do not compare the alternatives under grid-storage conditions                                   |
| Scientific entailment | Selected passages were read by the coding agent; this is not an independent subject-specialist review or a validated automatic entailment score |
| Coverage              | Two or three templated searches over five scholarly collections and the web are not an exhaustive literature review; some papers are background |
| Numerical fidelity    | Original-PDF spot checks are recorded below. Matching a cited review is distinct from independently confirming its underlying experiment.       |
| User usefulness       | No independent user study. The intended outcome is a defensible next paper to read, or recognising that the comparison cannot yet be made       |

The reviewer here was a coding agent. No human scientific certification, calibrated confidence or benchmark accuracy percentage is claimed. The remaining human judgement is whether the report helped choose the next read. The original-paper checks below do not establish broad research accuracy.

## Operational evidence

Local checks cover stable progressive blocks, refresh/offline recovery, polling after a premature clean stream close, partial failure, idempotent acceptance and stale-worker fencing. A full emulator restart retained the saved report. Two real duplicate Cloud Tasks deliveries left a completed task's snapshot, revision and attempt count unchanged, with no new provider operations.

A small local k6 read smoke made 50 reads with five concurrent readers: zero errors and 26.47ms p95 on the development machine. This does not measure production capacity. Selected light/dark contrast combinations passed; a physical-device keyboard and a full screen-reader review remain human checks.

Provisional evaluation goals are a relevant first source within 10 seconds after a worker starts, a useful checked result within 60 seconds on these narrow questions, and no silent loss or invented source identity. The long first Gemini 3.8 run missed the time goal. Quality, queue delay and cost are recorded separately so speed does not conceal unsupported claims.

The warm browser observation recorded 526 KB of encoded JavaScript for Discover and 597 KB for a task view, with first-contentful paint at 612ms and 1128ms respectively. These desktop-browser samples include cache effects and no network/CPU throttling; the payload remains larger than the desired lean target. Eight deployed client chunks were checked against the protected provider/session/access values; none contained those values.

The [cost record](costs.json) explicitly marks accounting as partial. Search is provider-measured; synthesis is estimated from tokens at declared prices. No task-level allocation or invoice reconciliation is implemented for shared infrastructure. These values are not complete measured per-task COGS. The [release record](release.json) timestamps the final deployment and allowance observation; reservations are exposure, not billed amounts.

## Checks against original papers (earlier release)

These are a coding agent’s spot checks of the earlier-release reports, not an independent scientific certification. Historical generated reports remain unchanged so their limitations stay visible.

| Claim                                                                                                | Original-paper check                                                                                                                                                                                                                                                    | Assessment                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cooling study has “103 cycles”                                                                       | The rendered first page of [Peprah et al.](https://arxiv.org/pdf/2607.10872), introduction, prints 103 with a baseline 3. This is also present in its HTML; it is not a lost superscript in our rendering. The statement cites Dondelewski et al.’s earlier experiment. | Matches the cited secondary paper. The underlying experimental count is not independently confirmed; the publisher full text was inaccessible. Do not silently replace it with 1000. |
| Sodium-ion theoretical value near 560 Wh/kg                                                          | [Massaro et al.](https://arxiv.org/pdf/2505.04391), Table 2 on printed page 23, has that value for average positive electrode material against sodium.                                                                                                                  | Numerically supported at the stated electrode/active-material basis. It is not measured pack-level energy density or field validation for grid deployment.                           |
| Sodium-ion energy density approaching commercial lithium-ion with lifespan still needing improvement | [El Kharbachi et al.](https://arxiv.org/pdf/2005.04963), summary on printed page 42, makes both points.                                                                                                                                                                 | Supported as that review’s assessment. It is historical context, not a fresh market assessment or grid deployment result.                                                            |
| Generic lithium-ion low-temperature findings                                                         | [Nazeeruddin et al.](https://arxiv.org/html/2512.15440v1), temperature and application-specific sections, reports the 10°C case and mild stationary C-rate guidance.                                                                                                    | These are model predictions for generic lithium-ion configurations, not measured LFP-versus-sodium-ion grid performance. The report should be read with that condition.              |
| A cited paper proves no direct grid studies exist                                                    | A limited retrieved set cannot establish absence across the literature.                                                                                                                                                                                                 | Not established. New synthesis instructions scope gaps to retrieved material; an attached citation does not prove completeness.                                                      |

For the cooling comparison, the [original experiment’s author-institution abstract](https://research-information.bris.ac.uk/en/publications/the-role-of-cell-geometry-when-selecting-tab-or-surface-cooling-t/) supports the qualitative dependence of degradation and useful energy on cell geometry and cooling approach. It does not establish a sodium-ion versus LFP ranking. This is why the product should help choose further reading rather than force a winner.

## Subsequent claim-support and retrieval check

The [support/latency record](claim-support-profile.json) preserves the known mixed-claim replay and same-question Pinterest samples. The primary source is [Pinterest’s published 2025 paper](https://www.pinterestcareers.com/media/554n4aaq/introducing-multi-modal-search-at-pinterest-a-new-user-experience.pdf). The first run found it but cropped the mechanism; query-focused source windows recovered that material. The current output explains the named candidate generators, multi-fetching, selected-object handling and reranking. It still marks missing evidence-limit coverage and does not prove current deployment details.

The model checker withheld unsupported/irrelevant draft claims before publication. Its judgements and generated coverage plan are fallible, and the timing samples are not a benchmark. Unrestricted primary searches plus an academic secondary search changed the retrieval mix; old scientific examples remain historical observations rather than being silently regenerated.
