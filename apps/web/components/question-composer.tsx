"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Plus, Sparkles } from "lucide-react";
import { decodeSnapshot, INPUT_LIMITS } from "@valyu-research/contracts";
import { taskKey } from "../lib/use-task";
import { diagnosticFor, responseError, type Diagnostic } from "../lib/diagnostic";
import { CopyControl } from "./copy-control";
import { ExampleControl } from "./example-control";
import { Button } from "../ui/looseleaf/components/ui/button";
import { Paper } from "../ui/looseleaf/components/ui/paper";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/looseleaf/components/ui/dropdown-menu";
import { useResearchDraft, updateResearchDraft, clearResearchDraft } from "../lib/research-draft";
type Example = { label: string; question: string; alternatives?: readonly [string, string] };
const examples: Record<"discover" | "compare", readonly Example[]> = {
  discover: [
    {
      label: "Try a question about battery research",
      question: "What evidence supports sodium-ion batteries for stationary grid storage?",
    },
    {
      label: "Explore microplastic detection",
      question:
        "Which methods detect microplastics in drinking water, and what are their detection limits?",
    },
    {
      label: "Explore protein folding",
      question: "Where do protein structure predictions still fall short of experimental evidence?",
    },
  ],
  compare: [
    {
      label: "Try comparing battery chemistries",
      question:
        "How do cycle life, operating temperature and evidence maturity compare for stationary grid storage?",
      alternatives: ["Sodium-ion", "Lithium iron phosphate"],
    },
    {
      label: "Compare carbon capture methods",
      question:
        "How do energy use and demonstrated capture rates compare under real operating conditions?",
      alternatives: ["Solid sorbents", "Liquid solvents"],
    },
    {
      label: "Compare microscopy techniques",
      question: "How do resolution and sample preparation compare for imaging protein complexes?",
      alternatives: ["Cryo-electron microscopy", "X-ray crystallography"],
    },
  ],
};
export function QuestionComposer({
  kind,
  children,
  showScenarios = true,
}: {
  kind: "discover" | "compare";
  children?: ReactNode;
  showScenarios?: boolean;
}) {
  const compare = kind === "compare";
  const router = useRouter();
  const queryClient = useQueryClient();
  const [exampleIndex, setExampleIndex] = useState(0);
  const draft = useResearchDraft(kind);
  const { question, first, second } = draft;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [failureDiagnostic, setFailureDiagnostic] = useState<Diagnostic | null>(null);
  const [scenario, setScenario] = useState("success");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const fieldId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const exampleChosen = useRef(false);
  function useExample(example: Example) {
    updateResearchDraft(kind, {
      question: example.question,
      first: example.alternatives?.[0] ?? "",
      second: example.alternatives?.[1] ?? "",
      submissionKey: null,
    });
    setFailure(null);
    exampleChosen.current = true;
  }
  function submitShortcut(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (!busy) event.currentTarget.form?.requestSubmit();
    }
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const submissionKey = draft.submissionKey ?? crypto.randomUUID();
    updateResearchDraft(kind, { submissionKey });
    try {
      const response = await fetch("/api/research/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": submissionKey,
          "X-Demo-Scenario": scenario,
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          schemaVersion: 1,
          kind,
          question,
          ...(compare ? { alternatives: [first, second] } : {}),
        }),
      });
      if (!response.ok) throw await responseError(response);
      const result = await response.json();
      const task = decodeSnapshot(result.id, result);
      queryClient.setQueryData(taskKey(task.id), task);
      void queryClient.invalidateQueries({
        queryKey: ["recent", "local-researcher"],
        refetchType: "none",
      });
      if (live.current) {
        clearResearchDraft(kind);
        router.push(`/tasks/${task.id}`);
      }
    } catch (cause) {
      if (live.current) {
        setFailureDiagnostic(diagnosticFor(cause));
        setFailure(
          cause instanceof Error
            ? cause.message
            : "The connection dropped. Try again to recover this attempt.",
        );
        setBusy(false);
      }
    }
  }

  return (
    <>
      <Paper
        as="section"
        stock="slip"
        edge="deckle"
        tilt={false}
        rules="none"
        shadow="hair"
        seed={`question-${kind}`}
        className="question-paper"
        aria-label={compare ? "Compare alternatives" : "Discover evidence"}
      >
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            {compare && (
              <div className="alternative-fields">
                <label>
                  First approach
                  <input
                    value={first}
                    onKeyDown={submitShortcut}
                    maxLength={INPUT_LIMITS.alternative}
                    required
                    onChange={(e) => {
                      updateResearchDraft(kind, { first: e.target.value, submissionKey: null });
                    }}
                    placeholder="e.g. Sodium-ion"
                  />
                </label>
                <span className="versus handwritten">vs.</span>
                <label>
                  Second approach
                  <input
                    value={second}
                    onKeyDown={submitShortcut}
                    maxLength={INPUT_LIMITS.alternative}
                    required
                    onChange={(e) => {
                      updateResearchDraft(kind, { second: e.target.value, submissionKey: null });
                    }}
                    placeholder="e.g. Lithium iron phosphate"
                  />
                </label>
              </div>
            )}
            <label className="question-label" htmlFor={fieldId}>
              Question
            </label>
            <textarea
              id={fieldId}
              ref={textarea}
              value={question}
              onKeyDown={submitShortcut}
              maxLength={INPUT_LIMITS.question}
              required
              onChange={(e) => {
                updateResearchDraft(kind, { question: e.target.value, submissionKey: null });
              }}
              placeholder={
                compare
                  ? "e.g. Which has better cycle life for grid storage?"
                  : "e.g. What evidence supports sodium-ion batteries for grid storage?"
              }
              rows={3}
            />
            <div className="form-bottom">
              <Button
                className="research-submit"
                type="submit"
                aria-keyshortcuts="Meta+Enter Control+Enter"
                title="Submit with ⌘ Enter or Ctrl Enter"
                disabled={
                  busy || !question.trim() || (compare && (!first.trim() || !second.trim()))
                }
              >
                {busy ? "Starting…" : compare ? "Compare evidence" : "Find evidence"}
                <ArrowRight size={17} />
              </Button>
            </div>
            {failure && (
              <div className="form-error" role="alert">
                <span>{failure}</span>
                {failureDiagnostic && (
                  <CopyControl
                    label="Copy submission error details"
                    text={JSON.stringify(failureDiagnostic, null, 2)}
                  />
                )}
              </div>
            )}
          </fieldset>
        </form>
      </Paper>
      <div className="question-examples">
        <ExampleControl>
          <button
            className="example-button"
            disabled={busy}
            onClick={() => {
              useExample(examples[kind][exampleIndex]!);
              exampleChosen.current = false;
              textarea.current?.focus({ preventScroll: true });
            }}
          >
            <Sparkles size={14} />
            {examples[kind][exampleIndex]!.label}
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                className="example-chevron"
                disabled={busy}
                aria-label="Choose an example question"
                title="Choose an example question"
              >
                <ChevronDown size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              tilt={false}
              edge="cut"
              seed={`examples-${kind}`}
              className="examples-menu"
              onCloseAutoFocus={(event) => {
                if (exampleChosen.current) {
                  event.preventDefault();
                  exampleChosen.current = false;
                  textarea.current?.focus({ preventScroll: true });
                }
              }}
            >
              {examples[kind].map((example, index) => (
                <DropdownMenuItem
                  key={example.label}
                  onSelect={() => {
                    setExampleIndex(index);
                    useExample(example);
                  }}
                  className="example-item"
                >
                  <span>{example.label}</span>
                  <small>{example.question}</small>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </ExampleControl>
      </div>
      {children}
      {showScenarios && process.env.NEXT_PUBLIC_APP_MODE !== "production" && (
        <details className="demo-options">
          <summary>
            <Plus size={13} />
            Local demo scenarios
          </summary>
          <label>
            Simulate
            <select
              disabled={busy}
              value={scenario}
              onChange={(e) => {
                setScenario(e.target.value);
                updateResearchDraft(kind, { submissionKey: null });
              }}
            >
              <option value="success">A completed research task</option>
              <option value="timeout">A source search timeout</option>
              <option value="no-evidence">No useful evidence</option>
              <option value="invalid-report">An invalid report citation</option>
              <option value="slow-stream">Slow saved sections</option>
              <option value="partial-report">Writing stops after one section</option>
            </select>
          </label>
          <p>Synthetic sources. No paid calls.</p>
        </details>
      )}
    </>
  );
}
