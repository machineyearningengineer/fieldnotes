"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
export function CopyControl({ text, label }: { text: string; label: string }) {
  const [result, setResult] = useState<{ text: string; kind: "copied" | "failed" } | null>(null);
  const state = result?.text === text ? result.kind : "idle";
  return (
    <span className="copy-control">
      <button
        type="button"
        className="copy-icon"
        aria-label={state === "copied" ? "Copied" : label}
        title={state === "copied" ? "Copied" : label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setResult({ text, kind: "copied" });
          } catch {
            setResult({ text, kind: "failed" });
          }
        }}
      >
        {state === "copied" ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {state === "failed" && <output className="copy-feedback">Copy unavailable.</output>}
    </span>
  );
}
