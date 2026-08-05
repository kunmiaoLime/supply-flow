# Session Write Mode

This is a Supply Flow-managed AI session. Its write behavior is persisted in
the project-local session index, not in an environment-specific skill.

Configured write mode: `<READ_ONLY_MODE>`

## Persistent State

- Current session ID: `<AI_SESSION_ID>`
- Project session index: `<PROJECT_SESSION_INDEX_PATH>`
- Read-only state updater: `<SESSION_MODE_UPDATER>`

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

## Mode Changes

When the user directly requests `read_only on` or `read_only off`:

1. Require exactly one mode argument, `on` or `off`. For any other form,
   report `Usage: read_only <on|off>` and do not change state.
2. Run the exact updater command above with `--mode on` or `--mode off`.
   That command updates this session's `readOnly` state in `sessions.json` and
   its matching session metadata.
3. Read the session index again, confirm this session's saved state, and
   report the active mode. The direct request authorizes only this state
   update; continue to follow the active mode for all other writes.

Do not invoke a global `read_only` skill. Follow this local write-mode policy
for the entire session.
