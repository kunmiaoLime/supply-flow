# Save Project Context

Save a durable project-context update from this current AI session.

Do not use the `save_context` skill and do not write anything beneath
`~/.codex/sessions`. That skill manages an assistant-session archive, not this
project's shared context.

The project is `<PROJECT_NAME>`. Its shared context document is:

`<PROJECT_CONTEXT_PATH>`

Its per-session handoff document is:

`<SESSION_CONTEXT_PATH>`

Read the existing context document first when it exists. Then update that same
document with concise, durable information learned during this session. Merge
new findings into the appropriate existing sections instead of replacing useful
information with a session transcript.

Capture only project-relevant knowledge that will help future AI sessions:

- confirmed purpose, terminology, requirements, constraints, and decisions
- repository architecture, important workflows, interfaces, and conventions
- document or Jira findings that affect implementation
- completed work, remaining work, risks, and open questions

Then update the per-session handoff document. Preserve its original session
instructions and write a concise, actionable handoff summary for the next AI
session, including work completed, relevant files changed, validation run,
current repository state, remaining steps, and blockers. The next session will
read this handoff before it takes over.

Do not include credentials, access tokens, private keys, raw chat transcripts,
or incidental command output. Do not modify application code, repository files,
project metadata, source documents, or Jira issues as part of this action. The
only permitted writes are `<PROJECT_CONTEXT_PATH>` and
`<SESSION_CONTEXT_PATH>`.

Create the context document if it does not yet exist. Before finishing, verify
that both documents exist and report the saved handoff and context update in
the terminal.
