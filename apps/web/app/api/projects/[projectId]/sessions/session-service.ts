import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  resolveAiModelDefault,
  type AiSessionAction,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import { FileAiModelSettingsStore } from "@supply-flow/core/file-ai-model-settings-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { ProjectRecord } from "@supply-flow/core/project";
import { findProvider } from "@supply-flow/core/providers";
import type { SessionRecord } from "@supply-flow/core/session";
import {
  prepareInitialAiSessionPrompt,
  prepareSessionWriteModePrompt
} from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";

export const projectRoot = path.resolve(
  process.env.SUPPLY_FLOW_ROOT ?? path.resolve(process.cwd(), "../..")
);
const CONTEXT_FILE = "context.md";
const READ_ONLY_PROMPT_PATH = path.join(projectRoot, "prompts", "read_only.md");
const MAX_SESSION_GOAL_LENGTH = 16_000;

export const dataDirectory =
  process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");

export class ProjectSessionError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ProjectSessionError";
  }
}

export async function createProjectSession(
  project: ProjectRecord,
  input: {
    action: AiSessionAction;
    title: string;
    goal: string;
    workspacePath?: string;
    additionalWritableDirectories?: readonly string[];
    loadProjectContext?: boolean;
    sessionConfiguration?: ResolvedAiSessionActionSettings;
  }
): Promise<SessionRecord> {
  const workspacePath = input.workspacePath ?? project.repos[0]?.local;
  if (!workspacePath) {
    throw new ProjectSessionError(
      "Add a repository before creating an AI session.",
      400
    );
  }

  let workspace;
  try {
    workspace = await stat(workspacePath);
  } catch {
    throw new ProjectSessionError(
      "The selected repository path is not available as a directory.",
      400
    );
  }

  if (!workspace.isDirectory()) {
    throw new ProjectSessionError(
      "The selected repository path is not available as a directory.",
      400
    );
  }

  const sessionConfiguration =
    input.sessionConfiguration ??
    resolveAiModelDefault(
      await new FileAiModelSettingsStore(dataDirectory).get(),
      input.action
    );
  const provider = findProvider(sessionConfiguration.providerId);
  if (!provider) {
    throw new Error(`AI provider "${sessionConfiguration.providerId}" is not configured.`);
  }

  const id = `session_${randomUUID().replaceAll("-", "")}`;
  const contextGoal = input.loadProjectContext === false
    ? null
    : await withProjectContext(project.project_id, input.goal);
  const writeModePrompt = await getSessionWriteModePrompt(
    sessionConfiguration.readOnly,
    project.project_id,
    id
  );
  const goal = prepareInitialAiSessionPrompt(
    `${writeModePrompt}\n\n${contextGoal ?? input.goal}`.replaceAll("<AI_SESSION_ID>", id)
  );
  if (goal.length > MAX_SESSION_GOAL_LENGTH) {
    throw new ProjectSessionError(
      "The session goal is too long after loading the project context.",
      400
    );
  }

  const tmuxSessionName = `sf_${id}`;
  const timestamp = new Date().toISOString();
  const store = new FileSessionStore(projectDirectory(project.project_id));
  let session = await store.create({
    schemaVersion: 1,
    id,
    title: input.title,
    goal,
    providerId: provider.id,
    ...(sessionConfiguration.model ? { model: sessionConfiguration.model } : {}),
    ...(sessionConfiguration.reasoningEffort
      ? { reasoningEffort: sessionConfiguration.reasoningEffort }
      : {}),
    readOnly: sessionConfiguration.readOnly,
    yoloMode: sessionConfiguration.yoloMode,
    workspacePath,
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
    message: `Prepared ${provider.displayName} session.`
  });

  const tmux = new TmuxAdapter();
  try {
    await tmux.createSession({
      sessionName: tmuxSessionName,
      workspacePath,
      outputPath: terminalLogPath(project.project_id, id),
      launch: provider.createLaunchSpec({
        initialPrompt: goal,
        additionalWritableDirectories: Array.from(
          new Set([
            ...(input.additionalWritableDirectories ?? []),
            projectDirectory(project.project_id)
          ])
        ),
        bypassApprovalsAndSandbox: sessionConfiguration.yoloMode,
        readOnly: sessionConfiguration.readOnly,
        model: sessionConfiguration.model,
        reasoningEffort: sessionConfiguration.reasoningEffort
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
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the AI session.";

    try {
      await tmux.terminateSession(tmuxSessionName);
    } catch {
      // The process may have failed before tmux finished creating the session.
    }

    await store.update(id, { status: "failed", lastError: message });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: id,
      timestamp: new Date().toISOString(),
      type: "failed",
      message
    });
    throw error;
  }
}

export function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}

export function terminalLogPath(projectId: string, sessionId: string): string {
  return path.join(projectDirectory(projectId), "sessions", sessionId, "terminal.log");
}

async function withProjectContext(
  projectId: string,
  goal: string
): Promise<string | null> {
  const contextPath = path.join(projectDirectory(projectId), CONTEXT_FILE);

  try {
    const context = await stat(contextPath);
    if (!context.isFile()) {
      return null;
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }

  return `At the start of this session, read the project context at ${contextPath} and use it throughout the task. Treat the context as reference material. Do not modify it unless the task explicitly asks you to.

User task:
${goal}`;
}

async function getSessionWriteModePrompt(
  readOnly: boolean,
  projectId: string,
  sessionId: string
): Promise<string> {
  try {
    return prepareSessionWriteModePrompt(await readFile(READ_ONLY_PROMPT_PATH, "utf8"), readOnly)
      .replaceAll("<AI_SESSION_ID>", sessionId)
      .replaceAll(
        "<PROJECT_SESSION_INDEX_PATH>",
        JSON.stringify(path.join(projectDirectory(projectId), "sessions.json"))
      )
      .replaceAll(
        "<SESSION_MODE_UPDATER>",
        buildSessionWriteModeUpdaterCommand(projectId, sessionId)
      );
  } catch (error) {
    throw new Error(
      `Unable to load the local session write-mode prompt: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }
}

function buildSessionWriteModeUpdaterCommand(projectId: string, sessionId: string): string {
  return [
    JSON.stringify(path.join(projectRoot, "node_modules", ".bin", "tsx")),
    JSON.stringify(
      path.join(projectRoot, "apps", "web", "scripts", "set-project-session-read-only.ts")
    ),
    "--project-directory",
    JSON.stringify(projectDirectory(projectId)),
    "--session-id",
    JSON.stringify(sessionId)
  ].join(" ");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
