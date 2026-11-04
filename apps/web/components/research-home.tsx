import { Shell } from "./shell";
import { QuestionComposer } from "./question-composer";
import { RecentNotes } from "./recent-notes";
export function ResearchHome({ kind }: { kind: "discover" | "compare" }) {
  const compare = kind === "compare";
  return (
    <Shell kind={kind}>
      <section className="intro">
        <h1>
          {compare ? (
            <>
              Different approaches.
              <br />
              <span className="title-accent">Shared questions.</span>
            </>
          ) : (
            <>
              Good questions deserve
              <br />
              <span className="title-accent">a little digging.</span>
            </>
          )}
        </h1>
      </section>
      <QuestionComposer kind={kind}>
        <RecentNotes />
      </QuestionComposer>
    </Shell>
  );
}
