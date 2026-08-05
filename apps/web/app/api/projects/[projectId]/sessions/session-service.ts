import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  resolveAiModelDefault,
  type AiSessionAction
} from "@supply-flow/core/ai-model-settings";
import { FileAiModelSettingsStore } from "@supply-flow/core/file-ai-model-settings-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { ProjectRecord } from "@supply-flow/core/project";
import { findProvider } from "@supply-flow/core/providers";
import type { SessionRecord } from "@supply-flow/core/session";
import { prepareInitialAiSessionPrompt } from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";

const projectRoot = path.resolve(process.cwd(), "../..");
const CONTEXT_FILE = "context.md";
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

  const provider = findProvider("codex");
  if (!provider) {
    throw new Error("Codex provider is not configured.");
  }
  const modelDefaults = resolveAiModelDefault(
    await new FileAiModelSettingsStore(dataDirectory).get(),
    input.action
  );

  const id = `session_${randomUUID().replaceAll("-", "")}`;
  const readOnlyOffAtStart = !modelDefaults.readOnly;
  const contextGoal = input.loadProjectContext === false
    ? null
    : await withProjectContext(project.project_id, input.goal, readOnlyOffAtStart);
  const goal = prepareInitialAiSessionPrompt(
    (
      contextGoal ??
      (readOnlyOffAtStart ? withReadOnlyOffInstruction(input.goal) : input.goal)
    ).replaceAll("<AI_SESSION_ID>", id)
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
    ...(modelDefaults.model ? { model: modelDefaults.model } : {}),
    ...(modelDefaults.reasoningEffort
      ? { reasoningEffort: modelDefaults.reasoningEffort }
      : {}),
    readOnly: modelDefaults.readOnly,
    yoloMode: modelDefaults.yoloMode,
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
        bypassApprovalsAndSandbox: modelDefaults.yoloMode,
        model: modelDefaults.model,
        reasoningEffort: modelDefaults.reasoningEffort
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
  goal: string,
  readOnlyOffAtStart = false
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

  return `${readOnlyOffAtStart ? `${withReadOnlyOffInstruction("")}\n` : ""}At the start of this session, read the project context at ${contextPath} and use it throughout the task. Treat the context as reference material. Do not modify it unless the task explicitly asks you to.

User task:
${goal}`;
}

function withReadOnlyOffInstruction(goal: string): string {
  return `Before doing anything else, process this direct user command: read_only off.

${goal}`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
