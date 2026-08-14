import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  AiProviderIdSchema,
  resolveAiModelDefault,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import type { AiInterfaceId } from "@supply-flow/core/ai-interface";
import { FileAiInterfaceStore } from "@supply-flow/core/file-ai-interface-store";
import { FileAiModelSettingsStore } from "@supply-flow/core/file-ai-model-settings-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { findProvider } from "@supply-flow/core/providers";
import {
  prependCodexWriteModeBootstrap,
  prepareInitialAiSessionPrompt,
  prepareSessionWriteModePrompt,
  sendAiSessionPrompt
} from "@supply-flow/core/session-prompt";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { dataDirectory, projectRoot } from "../../projects/[projectId]/sessions/session-service";

const execFile = promisify(execFileCallback);
const SETUP_SESSION_DIRECTORY = "ai-interface-sessions";
const SETUP_PROMPT_PATH = path.join(projectRoot, "prompts", "setup_ai_interfaces.md");
const READ_ONLY_PROMPT_PATH = path.join(projectRoot, "prompts", "read_only.md");
const TERMINAL_OUTPUT_LIMIT = 64 * 1_024;
const TERMINAL_SNAPSHOT_LINES = 200;
const MAX_SESSION_GOAL_LENGTH = 16_000;
const AUTHENTICATION_TIMEOUT_MS = 10 * 60 * 1_000;

export type AiInterfaceSetupAction = "verify" | "setup";

export class AiInterfaceSessionError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export function aiInterfaceSessionDirectory(): string {
  return path.join(dataDirectory, "settings", SETUP_SESSION_DIRECTORY);
}

export function aiInterfaceStatusPath(): string {
  return path.join(dataDirectory, "settings", "ai_interfaces.json");
}

export async function startOrResumeAiInterfaceSetupSession(input: {
  action: AiInterfaceSetupAction;
  interfaces: readonly AiInterfaceId[];
}): Promise<{ session: SessionRecord; resumed: boolean }> {
  await new FileAiInterfaceStore(dataDirectory).initialize();
  const store = new FileSessionStore(aiInterfaceSessionDirectory());
  const activeSession = await findActiveSession(store);
  const goal = await buildSetupGoal(input);

  if (activeSession) {
    try {
      await sendAiSessionPrompt(new TmuxAdapter(), activeSession.tmuxSessionName, goal);
    } catch {
      // A race with a terminal exit is reconciled by a fresh session below.
      const stopped = await reconcileAiInterfaceSession(store, activeSession);
      if (stopped.status === "starting" || stopped.status === "running") {
        throw new AiInterfaceSessionError("Unable to send the setup task to the active AI session.", 500);
      }
    }

    const current = await store.get(activeSession.id);
    if (current && (current.status === "starting" || current.status === "running")) {
      return { session: current, resumed: true };
    }
  }

  const settings = await new FileAiModelSettingsStore(dataDirectory).get();
  const configuration = resolveAiModelDefault(settings, "setup-ai-interface");
  const provider = findProvider(configuration.providerId);
  if (!provider) {
    throw new AiInterfaceSessionError(
      `AI provider "${configuration.providerId}" is not configured.`,
      500
    );
  }

  const workspace = await workspacePath();
  const id = `session_${randomUUID().replaceAll("-", "")}`;
  const prompt = await buildInitialPrompt(configuration, id, goal);
  if (prompt.length > MAX_SESSION_GOAL_LENGTH) {
    throw new AiInterfaceSessionError("The AI interface setup task is too long.", 400);
  }

  const tmuxSessionName = `sf_${id}`;
  const timestamp = new Date().toISOString();
  let session = await store.create({
    schemaVersion: 1,
    id,
    title: "AI interface setup",
    goal: prompt,
    providerId: provider.id,
    ...(configuration.model ? { model: configuration.model } : {}),
    ...(configuration.reasoningEffort
      ? { reasoningEffort: configuration.reasoningEffort }
      : {}),
    readOnly: configuration.readOnly,
    yoloMode: configuration.yoloMode,
    workspacePath: workspace,
    tmuxSessionName,
    status: "starting",
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await store.appendEvent({
    schemaVersion: 1,
    sessionId: id,
    timestamp,
    type: "created",
    message: `Prepared ${provider.displayName} AI interface setup session.`
  });

  const tmux = new TmuxAdapter();
  try {
    await tmux.createSession({
      sessionName: tmuxSessionName,
      workspacePath: workspace,
      outputPath: terminalLogPath(id),
      launch: provider.createLaunchSpec({
        initialPrompt: prompt,
        additionalWritableDirectories: [path.join(dataDirectory, "settings")],
        bypassApprovalsAndSandbox: configuration.yoloMode,
        readOnly: configuration.readOnly,
        model: configuration.model,
        reasoningEffort: configuration.reasoningEffort
      })
    });
    session = await store.update(id, { status: "running" });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: id,
      timestamp: new Date().toISOString(),
      type: "started",
      message: `Started ${provider.displayName} in ${tmuxSessionName}.`
    });
    return { session, resumed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the AI session.";
    try {
      await tmux.terminateSession(tmuxSessionName);
    } catch {
      // The process may have failed before tmux created the session.
    }

    await store.update(id, { status: "failed", lastError: message });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: id,
      timestamp: new Date().toISOString(),
      type: "failed",
      message
    });
    throw new AiInterfaceSessionError(message, 500);
  }
}

export async function listAiInterfaceSessions(): Promise<SessionRecord[]> {
  const store = new FileSessionStore(aiInterfaceSessionDirectory());
  const sessions = await store.list();
  return Promise.all(sessions.map((session) => reconcileAiInterfaceSession(store, session)));
}

export async function getAiInterfaceSession(sessionId: string): Promise<SessionRecord | null> {
  const store = new FileSessionStore(aiInterfaceSessionDirectory());
  const session = await store.get(sessionId);
  return session ? reconcileAiInterfaceSession(store, session) : null;
}

export async function terminateAiInterfaceSession(sessionId: string): Promise<boolean> {
  const store = new FileSessionStore(aiInterfaceSessionDirectory());
  const session = await store.get(sessionId);
  if (!session) {
    return false;
  }

  try {
    await new TmuxAdapter().terminateSession(session.tmuxSessionName);
  } catch {
    // The terminal may already be stopped.
  }
  await store.remove(session.id);
  return true;
}

export async function updateAiInterfaceSessionReadOnly(
  sessionId: string,
  readOnly: boolean
): Promise<SessionRecord> {
  const session = await getRunningAiInterfaceSession(sessionId);
  const store = new FileSessionStore(aiInterfaceSessionDirectory());
  const updated = await store.update(session.id, { readOnly });
  await sendAiSessionPrompt(
    new TmuxAdapter(),
    updated.tmuxSessionName,
    readOnlyModePrompt(readOnly, updated.providerId)
  );
  return updated;
}

export async function authenticateAiInterfaceSession(sessionId: string): Promise<void> {
  const session = await getAiInterfaceSession(sessionId);
  if (!session) {
    throw new AiInterfaceSessionError(`Unknown AI interface session "${sessionId}".`, 404);
  }

  const provider = AiProviderIdSchema.safeParse(session.providerId);
  if (!provider.success) {
    throw new AiInterfaceSessionError(
      `Authentication is not configured for ${session.providerId}.`,
      400
    );
  }

  const settings = await new FileAiModelSettingsStore(dataDirectory).get();
  await runAuthenticationCommand(
    settings.authenticationCommands[provider.data],
    session.workspacePath
  );
}

export async function openAiInterfaceSessionInNativeTerminal(sessionId: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new AiInterfaceSessionError(
      "Opening a native terminal is only available on macOS.",
      501
    );
  }

  const session = await getRunningAiInterfaceSession(sessionId);
  await openMacOSTerminal(session.tmuxSessionName);
}

export async function sendAiInterfaceTerminalInput(
  sessionId: string,
  input: string
): Promise<void> {
  const session = await getRunningAiInterfaceSession(sessionId);
  await new TmuxAdapter().sendTerminalInput(session.tmuxSessionName, input);
}

export async function resizeAiInterfaceTerminal(
  sessionId: string,
  columns: number,
  rows: number
): Promise<void> {
  const session = await getRunningAiInterfaceSession(sessionId);
  await new TmuxAdapter().resizeSession(session.tmuxSessionName, columns, rows);
}

export async function readAiInterfaceTerminalOutput(
  sessionId: string,
  requestedOffset: number | undefined,
  refreshFromTmux = false
): Promise<{
  output: string;
  outputOffset: number;
  outputSize: number;
  outputTruncated: boolean;
}> {
  const output = await readTerminalOutput(terminalLogPath(sessionId), requestedOffset);
  if (!refreshFromTmux && !output.outputTruncated) {
    return output;
  }

  const session = await getAiInterfaceSession(sessionId);
  if (!session) {
    return output;
  }

  try {
    return {
      ...output,
      output: toTerminalLines(
        await new TmuxAdapter().captureOutput(session.tmuxSessionName, TERMINAL_SNAPSHOT_LINES)
      ),
      outputTruncated: true
    };
  } catch {
    // The session can exit between the metadata lookup and terminal capture.
    return refreshFromTmux ? { ...output, outputTruncated: true } : output;
  }
}

export function outputOffsetFromRequest(request: Request): number | undefined {
  const offset = new URL(request.url).searchParams.get("offset");
  if (offset === null || !/^\d+$/.test(offset)) {
    return undefined;
  }

  const parsedOffset = Number(offset);
  return Number.isSafeInteger(parsedOffset) ? parsedOffset : undefined;
}

export function tmuxRefreshRequested(request: Request): boolean {
  return new URL(request.url).searchParams.get("refresh") === "tmux";
}

async function findActiveSession(store: FileSessionStore): Promise<SessionRecord | null> {
  const sessions = await store.list();
  for (const session of sessions) {
    const current = await reconcileAiInterfaceSession(store, session);
    if (current.status === "starting" || current.status === "running") {
      return current;
    }
  }

  return null;
}

async function getRunningAiInterfaceSession(sessionId: string): Promise<SessionRecord> {
  const session = await getAiInterfaceSession(sessionId);
  if (!session) {
    throw new AiInterfaceSessionError(`Unknown AI interface session "${sessionId}".`, 404);
  }
  if (session.status !== "starting" && session.status !== "running") {
    throw new AiInterfaceSessionError(`AI interface session "${sessionId}" is not running.`, 409);
  }

  return session;
}

async function reconcileAiInterfaceSession(
  store: FileSessionStore,
  session: SessionRecord
): Promise<SessionRecord> {
  if (session.status !== "starting" && session.status !== "running") {
    return session;
  }

  try {
    const activeSessions = await new TmuxAdapter().listSessions();
    if (activeSessions.includes(session.tmuxSessionName)) {
      return session;
    }
  } catch {
    // No tmux server means that the terminal stopped.
  }

  const stopped = await store.update(session.id, { status: "stopped" });
  await store.appendEvent({
    schemaVersion: 1,
    sessionId: session.id,
    timestamp: stopped.updatedAt,
    type: "stopped",
    message: `tmux session ${session.tmuxSessionName} is no longer active.`
  });
  return stopped;
}

async function workspacePath(): Promise<string> {
  try {
    const metadata = await stat(projectRoot);
    if (metadata.isDirectory()) {
      return projectRoot;
    }
  } catch {
    // Surface the consistent error below.
  }

  throw new AiInterfaceSessionError("The Supply Flow application directory is unavailable.", 500);
}

async function buildInitialPrompt(
  configuration: ResolvedAiSessionActionSettings,
  sessionId: string,
  goal: string
): Promise<string> {
  const writeModeTemplate = await readFile(READ_ONLY_PROMPT_PATH, "utf8");
  const writeModePrompt = prepareSessionWriteModePrompt(
    writeModeTemplate,
    configuration.readOnly
  )
    .replaceAll("<AI_SESSION_ID>", sessionId)
    .replaceAll(
      "<PROJECT_SESSION_INDEX_PATH>",
      JSON.stringify(path.join(aiInterfaceSessionDirectory(), "sessions.json"))
    )
    .replaceAll("<SESSION_MODE_UPDATER>", buildReadOnlyUpdaterCommand(sessionId));

  return prepareInitialAiSessionPrompt(`${writeModePrompt}\n\n${goal}`, {
    bootstrapCodexWriteMode: configuration.providerId === "codex" && !configuration.readOnly
  });
}

async function buildSetupGoal(input: {
  action: AiInterfaceSetupAction;
  interfaces: readonly AiInterfaceId[];
}): Promise<string> {
  const template = await readFile(SETUP_PROMPT_PATH, "utf8");
  const interfaces = input.interfaces.map((interfaceId) => `- ${interfaceId}`).join("\n");

  return template
    .replaceAll("<MODE>", input.action)
    .replaceAll("<SELECTED_INTERFACES>", interfaces)
    .replaceAll("<SUPPLY_FLOW_ROOT>", JSON.stringify(projectRoot))
    .replaceAll("<STATUS_FILE>", JSON.stringify(aiInterfaceStatusPath()))
    .replaceAll("<STATUS_UPDATER_COMMAND>", buildStatusUpdaterCommand());
}

function buildReadOnlyUpdaterCommand(sessionId: string): string {
  return [
    JSON.stringify(path.join(projectRoot, "node_modules", ".bin", "tsx")),
    JSON.stringify(
      path.join(projectRoot, "apps", "web", "scripts", "set-ai-interface-session-read-only.ts")
    ),
    "--session-directory",
    JSON.stringify(aiInterfaceSessionDirectory()),
    "--session-id",
    JSON.stringify(sessionId)
  ].join(" ");
}

function buildStatusUpdaterCommand(): string {
  return [
    JSON.stringify(path.join(projectRoot, "node_modules", ".bin", "tsx")),
    JSON.stringify(path.join(projectRoot, "apps", "web", "scripts", "set-ai-interface-status.ts")),
    "--data-directory",
    JSON.stringify(dataDirectory),
    "--interface",
    "<slack|google-doc|confluence|figma|circleci>",
    "--status",
    "<unknown|accessible|needs_setup|needs_user_action|error>",
    "--detail",
    JSON.stringify("<short status detail>")
  ].join(" ");
}

function readOnlyModePrompt(readOnly: boolean, providerId: string): string {
  const prompt = `Supply Flow changed this session's local read-only mode to ${
    readOnly ? "on" : "off"
  } and persisted it in the AI interface session index. Reload the current session's readOnly value before any filesystem write and follow the repository-local write-mode policy.`;

  return providerId === "codex" && !readOnly
    ? prependCodexWriteModeBootstrap(prompt)
    : prompt;
}

async function runAuthenticationCommand(command: string, workspacePath: string): Promise<void> {
  try {
    // The configurable command is only executed after an explicit local user action.
    await execFile(process.env.SHELL ?? "/bin/sh", ["-lc", command], {
      cwd: workspacePath,
      encoding: "utf8",
      maxBuffer: 64 * 1_024,
      timeout: AUTHENTICATION_TIMEOUT_MS
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new AiInterfaceSessionError(
        "The local shell is unavailable for the configured authentication command.",
        500
      );
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "killed" in error &&
      error.killed === true
    ) {
      throw new AiInterfaceSessionError(
        "The configured authentication command timed out before it was completed.",
        500
      );
    }

    throw new AiInterfaceSessionError(
      "The configured authentication command did not complete. Finish any required sign-in, then try again.",
      500
    );
  }
}

async function openMacOSTerminal(tmuxSessionName: string): Promise<void> {
  if (!/^sf_[A-Za-z0-9_-]+$/.test(tmuxSessionName)) {
    throw new AiInterfaceSessionError("The tmux session name is invalid.", 500);
  }

  try {
    await execFile(
      "osascript",
      [
        "-e",
        `tell application "Terminal"
  activate
  do script "tmux attach -t ${tmuxSessionName}"
end tell`
      ],
      { encoding: "utf8", maxBuffer: 32_768 }
    );
  } catch {
    throw new AiInterfaceSessionError(
      "macOS could not open Terminal. Check that Terminal is available and allow automation if prompted.",
      500
    );
  }
}

function terminalLogPath(sessionId: string): string {
  return path.join(aiInterfaceSessionDirectory(), "sessions", sessionId, "terminal.log");
}

async function readTerminalOutput(
  filePath: string,
  requestedOffset: number | undefined
): Promise<{
  output: string;
  outputOffset: number;
  outputSize: number;
  outputTruncated: boolean;
}> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(filePath, "r");
    const size = (await handle.stat()).size;
    let start = requestedOffset ?? Math.max(0, size - TERMINAL_OUTPUT_LIMIT);
    let outputTruncated = false;

    if (start > size || size - start > TERMINAL_OUTPUT_LIMIT) {
      start = Math.max(0, size - TERMINAL_OUTPUT_LIMIT);
      outputTruncated = true;
    }

    const output = Buffer.alloc(size - start);
    await handle.read(output, 0, output.length, start);
    return {
      output: output.toString("utf8").replaceAll("\u0000", ""),
      outputOffset: start,
      outputSize: size,
      outputTruncated
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        output: "",
        outputOffset: 0,
        outputSize: 0,
        outputTruncated: false
      };
    }

    throw error;
  } finally {
    await handle?.close();
  }
}

function toTerminalLines(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
