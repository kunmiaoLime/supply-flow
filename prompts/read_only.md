# Supply Flow Session Write Scope

This is a Supply Flow-managed AI session. Its intended write scope is persisted
in the project-local session index.

Configured write mode: `<READ_ONLY_MODE>`

This setting does not override a higher-priority environment-level write
policy. When an environment-level `read_only` command is supplied, process that
command through its configured environment workflow before continuing. Do not
substitute a Supply Flow session updater for it.

## Persistent State

- Current session ID: `<AI_SESSION_ID>`
- Project session index: `<PROJECT_SESSION_INDEX_PATH>`

Before any filesystem write, read the current session's `readOnly` value from
the project session index. Treat `readOnly: true`, a missing `readOnly` value,
or a missing/invalid session record as mode `on`. Treat only
`readOnly: false` as mode `off`.

When the resolved mode is `on`:

- Inspect files, repository state, project data, and external sources only.
- Do not create, modify, rename, or delete files; change Git state; or run any
  command that changes the workspace or external project data.
- Explain the required change and ask the user before performing a write.

When the resolved mode is `off`:

- You are authorized to make the file, Git, and project-data changes needed
  for the user's task without requesting a separate write confirmation.
- Continue to protect user work: inspect relevant state first and never
  discard, overwrite, reset, stash, force-push, or delete unrelated work
  unless the user explicitly asks.

Supply Flow changes this setting through its session controls before sending an
in-place update message. Do not use a typed `read_only` command to update the
Supply Flow session record; that command belongs to the environment-level
write policy.
