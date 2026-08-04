# Supply Flow

Supply Flow is an AI session control plane. Each model session runs in its own
tmux session and Git worktree. Provider-specific adapters normalize terminal
CLIs such as Codex, Claude Code, and Gemini CLI.

## Architecture

```text
Next.js web app
       |
Session runner
       |
tmux adapter
       |
Provider adapters
       |
Git worktree per session
```

The first version deliberately has no database. Session metadata is stored as
JSON and terminal events are appended to NDJSON beneath `.supply-flow/`.
Storage is isolated behind interfaces so a future Postgres implementation can
replace the file store without changing the runner or web contracts.

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- tmux 3.3 or newer

## Setup

```sh
npm install
npm run dev
```

The web app starts at <http://localhost:3000>.

## Runner commands

```sh
npm run runner:doctor
npm run runner -- list
npm run runner -- start codex /absolute/path/to/worktree "Review the repository"
npm run runner -- stop <session-id>
```

The `start` command launches the provider executable in a dedicated tmux
session. The provider must already be installed and authenticated by the host.

## Local state

```text
.supply-flow/
  projects/<project-id>/project.json
  projects/<project-id>/context.md
  projects/<project-id>/sessions/<session-id>/meta.json
  projects/<project-id>/sessions/<session-id>/events.ndjson
  projects/<project-id>/sessions/<session-id>/terminal.log
  sessions/<session-id>/... (manual runner sessions)
```

Project IDs are derived from the display name as lowercase kebab-case. A
duplicate name receives a numeric suffix, such as `customer-acme-sync-2`.
Each `project.json` contains `project_name`, `project_id`, `repos`, and
`documents` arrays. Every repository entry stores a `name`, local checkout
`local` path, and a Git-origin `remote`, which is `null` when the checkout has
no `origin`. Adding a repository validates its local path with Git, derives its
remote and name from the enclosing repository, and retains the selected local
path as the project scope. A local path may begin with `~/` as shorthand for
the current user's home directory.

Each document source stores a `type` of `google-doc`, `confluence`, `figma`,
or `slack`, together with its source `link`.

`context.md` is created and updated by a dedicated AI session. It summarizes
the configured document sources and repository scopes for future sessions.

No provider credentials are written to this directory. Provider authentication
remains the responsibility of each CLI and its host environment.
