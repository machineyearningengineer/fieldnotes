import { Sprout } from "lucide-react";
export default async function Access({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const { invalid } = await searchParams;
  return (
    <main id="main-content" className="app-shell">
      <div className="wordmark">
        <Sprout size={23} />
        fieldnotes.
      </div>
      <section className="intro">
        <h1>
          Open your
          <br />
          <span className="title-accent">fieldnotes.</span>
        </h1>
      </section>
      <form className="question-paper" action="/api/session" method="post">
        <label htmlFor="access-code">Demonstration access code</label>
        <input
          id="access-code"
          name="code"
          type="password"
          required
          autoComplete="current-password"
          maxLength={100}
        />
        {invalid && <p role="alert">That code was not recognised.</p>}
        <button className="primary-button" type="submit">
          Open Fieldnotes
        </button>
      </form>
    </main>
  );
}
