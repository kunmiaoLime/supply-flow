import { defaultProviders } from "@supply-flow/core/providers";

export default function Home() {
  return (
    <main>
      <section>
        <p className="eyebrow">Supply Flow</p>
        <h1>AI sessions, one terminal control plane.</h1>
        <p className="summary">
          This empty product scaffold is ready for tmux-backed provider sessions and
          file-based local state.
        </p>
      </section>

      <section className="grid" aria-label="Initial system boundaries">
        <article>
          <h2>Session runner</h2>
          <p>Creates one tmux session and one Git worktree per AI session.</p>
        </article>
        <article>
          <h2>Provider adapters</h2>
          <ul>
            {defaultProviders.map((provider) => (
              <li key={provider.id}>{provider.displayName}</li>
            ))}
          </ul>
        </article>
        <article>
          <h2>Local state</h2>
          <p>JSON metadata and NDJSON event logs under <code>.supply-flow</code>.</p>
        </article>
      </section>
    </main>
  );
}
