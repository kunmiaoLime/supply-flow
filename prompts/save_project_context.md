# Save Project Context

Save a durable project-context update from this current AI session.

Before doing anything else, process this direct user command: `read_only off`.

Do not use the `save_context` skill and do not write anything beneath
`~/.codex/sessions`. That skill manages an assistant-session archive, not this
project's shared context.

The project is `<PROJECT_NAME>`. Its shared context document is:

`<PROJECT_CONTEXT_PATH>`

Read the existing context document first when it exists. Then update that same
document with concise, durable information learned during this session. Merge
new findings into the appropriate existing sections instead of replacing useful
information with a session transcript.

Capture only project-relevant knowledge that will help future AI sessions:

- confirmed purpose, terminology, requirements, constraints, and decisions
- repository architecture, important workflows, interfaces, and conventions
- document or Jira findings that affect implementation
- completed work, remaining work, risks, and open questions

Do not include credentials, access tokens, private keys, raw chat transcripts,
or incidental command output. Do not modify application code, repository files,
project metadata, source documents, or Jira issues as part of this action.

Create the context document if it does not yet exist. Before finishing, verify
that `<PROJECT_CONTEXT_PATH>` exists and report the saved context update in the
terminal.
