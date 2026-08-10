# Manage Supply Flow AI Interfaces

Set up or verify access for the selected external interfaces used by Supply
Flow AI sessions.

Use this repository-owned workflow. Do not load or use global skills, helpers,
or templates beneath `~/.codex` or `$CODEX_HOME`.

## Task

- Mode: `<MODE>`
- Selected interfaces:
<SELECTED_INTERFACES>
- Supply Flow application root: `<SUPPLY_FLOW_ROOT>`
- Persisted interface status file: `<STATUS_FILE>`
- Status updater command:

```sh
<STATUS_UPDATER_COMMAND>
```

## Rules

1. Work only on the selected interfaces. Complete them one at a time in the
   listed order.
2. Never print, log, copy, or write credentials, OAuth tokens, authorization
   headers, or Slack bot tokens to project files or terminal output. Keep
   secrets in memory only, except when the operating system's credential store
   or an interface's supported authentication flow stores them securely.
3. After each selected interface, run the status updater command exactly once,
   replacing its placeholders with the interface id, final status, and a short
   non-sensitive result. Use one of:
   - `accessible`: a real authenticated access check succeeded
   - `needs_setup`: the required CLI, integration, credential, or permission
     is not configured
   - `needs_user_action`: the user must complete a browser sign-in, grant
     access, invite a bot, or provide a required value
   - `error`: a non-sensitive technical failure prevented a useful check
4. Do not report `accessible` based only on a CLI being installed or a
   configuration file being present. Verify authenticated access when the
   interface permits it.
5. In `verify` mode, inspect only. Do not install software, change
   configuration, start an OAuth flow, or modify credentials.
6. In `setup` mode, make only the changes needed for the current interface.
   Use official tools and supported setup flows. If completing setup needs
   interactive user input or a secret, stop at that interface, explain the
   required action, record `needs_user_action`, and continue with the next
   selected interface.
7. Do not modify Supply Flow application code, project data, or user
   repositories. The status updater is the only Supply Flow data write allowed.

## Interface Checks

### Slack (`slack`)

- The document reader uses `slackread`. Confirm that it is installed and can
  use its configured credential without exposing the credential.
- A Slack bot must be able to access a channel before channel content can be
  read. If no safe channel-level check is possible without a user-provided
  channel link, record `needs_user_action` and request a channel link plus an
  invitation for the bot.
- In setup mode, use the supported `slackread` setup path and request the user
  to provide or authorize the Slack bot only through a secure mechanism.

### Google Docs (`google-doc`)

- Confirm `gws` is installed, then use `gws auth status` to inspect the
  current user's authentication without exporting credentials.
- In setup mode, use the supported `gws auth login` flow when authentication
  or Google Docs scopes are missing. Do not run `gws auth export`.
- Mark access `accessible` only when the CLI is authenticated with the Google
  Docs read capability. A specific document may still require sharing with
  that account.

### Confluence (`confluence`)

- The existing readers use macOS Keychain entries `confluence-api-email` and
  `confluence-api-token`. Retrieve values only into shell variables; never
  print them.
- Verify access with an authenticated, read-only Confluence API request when
  the configured Lime Atlassian site is available. Do not use unauthenticated
  browser requests.
- In setup mode, use the macOS Keychain and the user's supplied Atlassian API
  credential through a supported secure flow. If the user must create a token
  or approve access, record `needs_user_action`.

### Figma (`figma`)

- Confirm that the current AI provider environment has an authenticated Figma
  integration capable of reading Figma design metadata. Do not scrape Figma
  web pages or rely on unauthenticated exports.
- In setup mode, inspect the provider's supported Figma integration
  configuration and use its official authentication process. Do not install
  an untrusted MCP server or persist a raw Figma token in the repository.
- If setup requires an interactive browser authorization, record
  `needs_user_action` with the exact non-sensitive action the user must take.

## Completion

After all selected interfaces have a recorded status, report a concise table
of interface, final status, evidence, and remaining user actions. Do not
repeat or expose any sensitive value.
