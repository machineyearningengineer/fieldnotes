"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Download,
  FileText,
  Printer,
  Search,
  X,
  AlertCircle,
} from "lucide-react";
import type { Source } from "@valyu-research/contracts";
import { ResearchModal } from "./research-modal";
import { ReportBody } from "./report-body";
import { CopyControl } from "./copy-control";
import { DraftState } from "./draft-state";
import { ReadingTree, type ReportHeading } from "./reading-tree";
import { ScientificText } from "./scientific-text";
import { SourceExcerpt } from "./source-excerpt";
import { sourceSummary } from "../lib/source-text";
import { SourceSheet, SourceTitle } from "./source-sheet";
import { Shell } from "./shell";
import { sourceTypeLabel } from "../lib/source-label";
import { useBrowserSearch, setPanel } from "../lib/browser-location";
import { useTask } from "../lib/use-task";
const stages = [
  { id: "searching", label: "Find evidence" },
  { id: "writing", label: "Write the brief" },
  { id: "checking", label: "Check sources" },
];
export function TaskView({ id }: { id: string }) {
  const { data: task, error, connection, diagnostic } = useTask(id);
  const params = new URLSearchParams(useBrowserSearch());
  const selected = params.get("source");
  const compose = params.get("compose");
  const composerOpen = compose === "discover" || compose === "compare";
  const composerTrigger = useRef<HTMLElement | null>(null);
  const composerOpenedHere = useRef(false);
  const [inspected, setInspected] = useState<string | null>(null);
  const source = task?.sources.find((item) => item.id === (selected ?? inspected));
  const [headings, setHeadings] = useState<ReportHeading[]>([]);
  const reportRef = useRef<HTMLDivElement>(null);
  const blocks = task?.reportDraft?.blocks;
  const report = task?.report;
  const hasContent = !!(blocks?.length || report);
  useLayoutEffect(() => {
    const node = reportRef.current;
    const next = node
      ? [...node.querySelectorAll("h1,h2,h3,h4")]
          .map((element) => ({
            id: element.id,
            title: element.textContent ?? "",
            level: Number(element.tagName.slice(1)),
          }))
          .concat([{ id: "sources", title: "Sources", level: 2 }])
      : [];
    setHeadings((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  }, [blocks, report]);
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openedHere = useRef(false);
  const openSource = useCallback((item: Source, origin?: HTMLElement) => {
    setInspected(item.id);
    trigger.current = origin ?? (document.activeElement as HTMLElement);
    openedHere.current = true;
    setPanel("source", item.id, true);
  }, []);
  function openComposer(trigger: HTMLButtonElement) {
    composerTrigger.current = trigger;
    composerOpenedHere.current = true;
    setPanel("compose", task?.input.kind ?? "discover", true);
  }
  function closeComposer() {
    if (composerOpenedHere.current) {
      composerOpenedHere.current = false;
      window.history.back();
    } else setPanel("compose", null);
  }
  function closeSource() {
    if (source) setInspected(source.id);
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else setPanel("source", null);
  }

  function download() {
    if (!task?.report) return;
    const references = task.sources
      .map((item, index) => `${index + 1}. ${item.title}\n   ${item.url}`)
      .join("\n");
    const text = `# ${task.input.question}\n\n${task.simulation ? "Synthetic local demonstration. Not scientific findings.\n\n" : ""}${task.report}\n\n## Sources\n\n${references}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `fieldnotes-${task.input.kind}-${task.id.slice(0, 8)}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!task)
    return (
      <Shell>
        <section className="task-loading" aria-live="polite">
          {error ? (
            <>
              <AlertCircle />
              <h1>We couldn’t open this note.</h1>
              <p>{error.message}</p>
              <CopyControl
                label="Copy connection error details"
                text={JSON.stringify(diagnostic, null, 2)}
              />
              <Link href="/discover">Back to research</Link>
            </>
          ) : (
            <>
              <span className="ink-spinner" />
              <p>Opening your research…</p>
            </>
          )}
        </section>
      </Shell>
    );
  const complete = task.status === "succeeded";
  const failed = task.status === "failed";
  const activeIndex = stages.findIndex((item) => item.id === task.stage);
  const connectionHint =
    complete || failed
      ? null
      : connection === "offline"
        ? "Offline. Showing saved progress."
        : connection === "polling"
          ? "Reconnecting. Checking saved progress."
          : connection === "paused"
            ? "Updates paused while this tab is hidden."
            : null;
  return (
    <Shell kind={task.input.kind} inert={(!!selected && !!source) || composerOpen}>
      <div className="report-layout">
        <aside className="reading-rail">
          <ReadingTree headings={headings} onNew={openComposer} />
        </aside>
        <article className="research-report">
          <div className="report-heading">
            {task.simulation && (
              <p className="print-simulation">Synthetic demonstration. Not scientific findings.</p>
            )}
            <h1>{task.input.question}</h1>
            {task.input.kind === "compare" && (
              <div className="comparison-labels">
                <span>{task.input.alternatives[0]}</span>
                <span className="handwritten">vs.</span>
                <span>{task.input.alternatives[1]}</span>
              </div>
            )}
            <div className="report-meta">
              <span>
                {complete && (!task.outcome || task.outcome === "answered") ? (
                  <Check size={14} />
                ) : complete ? (
                  <Circle size={14} />
                ) : failed ? (
                  <AlertCircle size={14} />
                ) : (
                  <Clock3 size={14} />
                )}{" "}
                {complete
                  ? task.outcome === "answered"
                    ? "Answered"
                    : task.outcome === "partial"
                      ? "Partly answered"
                      : task.outcome === "unanswered"
                        ? "Not directly answered"
                        : "Evidence brief"
                  : failed
                    ? "Research stopped"
                    : task.stage === "queued"
                      ? "Queued"
                      : task.stage === "searching"
                        ? "Finding sources"
                        : task.stage === "checking"
                          ? "Checking draft"
                          : "Writing draft"}
              </span>
              <a className="source-count" href="#sources">
                {task.sources.length} sources
              </a>
              <time className="task-date" dateTime={task.createdAt}>
                {new Date(task.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                })}
              </time>
            </div>
          </div>
          {!complete && !failed && !hasContent && (
            <section className="progress-note" aria-live="polite">
              <span className="handwritten progress-title">Researching</span>
              <div className="stage-list">
                {stages.map((stage, index) => (
                  <div
                    key={stage.id}
                    className={
                      index < activeIndex
                        ? "stage done"
                        : index === activeIndex
                          ? "stage active"
                          : "stage"
                    }
                  >
                    {index < activeIndex ? (
                      <Check size={16} />
                    ) : index === activeIndex ? (
                      <span className="ink-spinner" />
                    ) : (
                      <Circle size={14} />
                    )}
                    <span>{stage.label}</span>
                  </div>
                ))}
              </div>
              {connectionHint && (
                <div className="connection-note">
                  <output>{connectionHint}</output>
                  {diagnostic && (
                    <CopyControl
                      label="Copy connection error details"
                      text={JSON.stringify(diagnostic, null, 2)}
                    />
                  )}
                </div>
              )}
            </section>
          )}
          {failed && (
            <section className="failure-note" role="alert">
              <AlertCircle size={23} />
              <h2>
                {task.error?.code === "NO_EVIDENCE" ? "Evidence incomplete" : "Research failed"}
              </h2>
              <p>{task.error?.message}</p>
              <div className="failure-details">
                <p className="failure-code">
                  Error: {task.error?.code}
                  <br />
                  Reference: <span title={task.traceId}>{task.traceId}</span>
                </p>
                <CopyControl
                  label="Copy error details"
                  text={JSON.stringify(
                    {
                      version: 1,
                      boundary: "research-worker",
                      taskId: task.id,
                      reference: task.traceId,
                      code: task.error?.code,
                      message: task.error?.message,
                    },
                    null,
                    2,
                  )}
                />
              </div>
              <Link className="primary-button" href={`/${task.input.kind}`}>
                Start a new attempt
                <ArrowUpRight size={16} />
              </Link>
            </section>
          )}
          {hasContent && (
            <>
              <div
                className="markdown-report"
                id="report-content"
                ref={reportRef}
                aria-label={complete ? "Evidence brief" : "Unfinished draft"}
              >
                <ReportBody
                  blocks={blocks ?? null}
                  animateInitial={connection === "streaming" || connection === "polling"}
                  report={report ?? null}
                  sources={task.sources}
                  onSource={openSource}
                />
              </div>
              {connectionHint && (
                <div className="connection-note">
                  <output>{connectionHint}</output>
                  {diagnostic && (
                    <CopyControl
                      label="Copy connection error details"
                      text={JSON.stringify(diagnostic, null, 2)}
                    />
                  )}
                </div>
              )}
              {!complete && (
                <DraftState
                  task={task}
                  connected={connection !== "offline" && connection !== "paused"}
                />
              )}
              {complete && (
                <div className="report-actions">
                  <div>
                    <button className="icon-action" onClick={download}>
                      <Download size={15} />
                      Markdown
                    </button>
                    <button className="icon-action" onClick={() => window.print()}>
                      <Printer size={15} />
                      Print
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <section className="sources-section" id="sources" tabIndex={-1}>
            <div className="section-heading">
              <h2>Sources</h2>
              <span>{task.sources.length} sources</span>
            </div>
            <ol className="print-sources">
              {task.sources.map((item) => (
                <li key={item.id}>
                  <strong>
                    <ScientificText>{item.title}</ScientificText>
                  </strong>
                  <span className="print-source-meta">{item.authors.join(", ")}</span>
                  {item.publishedAt && (
                    <span className="print-source-meta">Published {item.publishedAt}</span>
                  )}
                  <a href={item.url}>{item.url}</a>
                </li>
              ))}
            </ol>
            {task.sources.length === 0 ? (
              <p className="muted">Sources will appear as the research finds them.</p>
            ) : (
              <ol className="source-cards">
                {task.sources.map((item, index) => (
                  <li key={item.id}>
                    <button
                      className="source-card"
                      onClick={(event) => openSource(item, event.currentTarget)}
                      aria-haspopup="dialog"
                    >
                      <span className="source-index">[{index + 1}]</span>
                      <span className="source-card-body">
                        <span className="source-title">
                          <ScientificText>{item.title}</ScientificText>
                        </span>
                        <span className="source-card-byline">
                          {item.authors.length > 2
                            ? `${item.authors[0]} et al.`
                            : item.authors.join(", ")}
                          {item.publishedAt && (
                            <time dateTime={item.publishedAt}>
                              {new Date(item.publishedAt).getFullYear()}
                            </time>
                          )}
                        </span>
                        <span className="source-type">{sourceTypeLabel(item)}</span>
                        <span className="source-relevance">
                          <ScientificText>{sourceSummary(item.relevance)}</ScientificText>
                        </span>
                      </span>
                      <ArrowUpRight size={17} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <details className="search-trail">
            <summary>
              <Search size={15} />
              <span>See the search trail</span>
              <ChevronDown size={15} />
            </summary>
            <div>
              {task.queries.map((query) => (
                <div className="query-item" key={query.id}>
                  <span>
                    {query.status === "complete" ? <Check size={14} /> : <Circle size={13} />}
                  </span>
                  <div>
                    <p>{query.purpose}</p>
                    <code>{query.query}</code>
                    <small>
                      {query.status === "complete"
                        ? `${query.sourceIds.length} sources`
                        : "Waiting"}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </details>
          {task.usage.length > 0 && (
            <details className="search-trail">
              <summary>
                <span>Research usage</span>
                <ChevronDown size={15} />
              </summary>
              <div>
                {task.usage.map((use) => (
                  <div className="query-item" key={use.operationId}>
                    <div>
                      <p>
                        {use.service === "search"
                          ? "Search"
                          : use.operationId.includes(":support-")
                            ? "Passage check"
                            : "Synthesis"}
                      </p>
                      <small>
                        {use.state === "settled" && use.costMicros !== null
                          ? new Intl.NumberFormat("en-GB", {
                              style: "currency",
                              currency: "USD",
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 6,
                            }).format(use.costMicros / 1_000_000)
                          : "Cost unconfirmed; allowance retained"}
                        {use.basis === "estimate" && use.state === "settled"
                          ? " estimated from tokens"
                          : ""}
                      </small>
                      <small>{use.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="task-reference">
            <span>
              Reference <code>{task.traceId.slice(0, 12)}</code>
            </span>
            <CopyControl
              label="Copy support reference"
              text={JSON.stringify(
                { version: 1, taskId: task.id, reference: task.traceId },
                null,
                2,
              )}
            />
          </div>
        </article>
      </div>
      <ResearchModal
        open={composerOpen}
        kind={compose === "compare" ? "compare" : "discover"}
        onKindChange={(kind) => setPanel("compose", kind)}
        onClose={closeComposer}
        onReturn={() =>
          (composerTrigger.current?.isConnected
            ? composerTrigger.current
            : document.getElementById("main-content")
          )?.focus({ preventScroll: true })
        }
      />
      {source && (
        <>
          <SourceSheet
            open={!!selected && !!source}
            onClose={closeSource}
            onReturn={() =>
              (trigger.current?.isConnected
                ? trigger.current
                : document.getElementById("main-content")
              )?.focus({ preventScroll: true })
            }
          >
            <div className="source-panel-top">
              <span className="handwritten">Source</span>
              <button
                ref={closeButton}
                className="close-button"
                onClick={closeSource}
                aria-label="Close source"
              >
                <X size={20} />
              </button>
            </div>
            <span className="source-type">{sourceTypeLabel(source)}</span>
            <SourceTitle className="source-paper-title">
              <ScientificText>{source.title}</ScientificText>
            </SourceTitle>
            <p className="source-byline">
              {source.authors.some((author) => author.trim()) && (
                <>
                  {source.authors.join(", ")}
                  <br />
                </>
              )}
              {source.publishedAt
                ? new Date(source.publishedAt).toLocaleDateString("en-GB", {
                    year: "numeric",
                    month: "long",
                  })
                : "Publication date unavailable"}
            </p>
            <hr />
            {sourceSummary(source.relevance).trim() && (
              <>
                <h3>Summary</h3>
                <p>{sourceSummary(source.relevance)}</p>
              </>
            )}
            <h3>Extracted text</h3>
            <SourceExcerpt key={source.id} text={source.excerpt} />
            <div className="source-provenance">
              <FileText size={16} />
              <p>
                Matched by{" "}
                {source.queryIds
                  .map((queryId) => task.queries.find((query) => query.id === queryId)?.purpose)
                  .join("; ")}
                .
              </p>
            </div>
            {task.simulation ? (
              <p className="simulation-notice">
                Synthetic fixture. No paper has been fetched or verified.
              </p>
            ) : (
              <a
                className="primary-button"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original source <ArrowUpRight size={15} />
              </a>
            )}
            <button className="secondary-button" onClick={closeSource}>
              <ArrowLeft size={15} />
              Back to note
            </button>
          </SourceSheet>
        </>
      )}
    </Shell>
  );
}
