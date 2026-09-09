import { readFile } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import {
  sendAiSessionPrompt,
  withoutCodexWriteModeBootstrap
} from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import type { SessionRecord } from "@supply-flow/core/session";
import { dataDirectory, projectDirectory } from "../../session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const promptPath = path.join(projectRoot, "prompts", "save_project_context.md");
const tmux = new TmuxAdapter();

interface SessionRouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function POST(_request: Request, context: SessionRouteContext) {
  const { projectId, sessionId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const store = new FileSessionStore(projectDirectory(project.project_id));
    const session = await store.get(sessionId);
    if (!session) {
      return NextResponse.json({ error: `Unknown AI session "${sessionId}".` }, { status: 404 });
    }

    const activeSessions = await tmux.listSessions();
    if (!activeSessions.includes(session.tmuxSessionName)) {
      return NextResponse.json(
        { error: "This tmux session is no longer running." },
        { status: 409 }
      );
    }

    const savedSession =
      session.contextFile && (await store.readContext(session.id)) !== null
        ? session
        : await store.saveContext(session.id, initialSessionHandoff(session, project.project_id));
    await sendAiSessionPrompt(
      tmux,
      session.tmuxSessionName,
      await projectContextPrompt(project.project_name, project.project_id, savedSession)
    );
    return NextResponse.json({ sent: true, session: savedSession });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to send the project-context prompt to the AI session."
      },
      { status: 500 }
    );
  }
}

async function projectContextPrompt(
  projectName: string,
  projectId: string,
  session: SessionRecord
): Promise<string> {
  const template = await readFile(promptPath, "utf8");
  const contextPath = path.join(projectDirectory(projectId), "context.md");
  const sessionContextPath = path.join(
    projectDirectory(projectId),
    session.contextFile ?? `sessions/${session.id}.md`
  );
  return template
    .replaceAll("<PROJECT_NAME>", JSON.stringify(projectName))
    .replaceAll("<PROJECT_CONTEXT_PATH>", JSON.stringify(contextPath))
    .replaceAll("<SESSION_CONTEXT_PATH>", JSON.stringify(sessionContextPath));
}

function initialSessionHandoff(session: SessionRecord, projectId: string): string {
  const model = session.model ? ` (${session.model})` : "";
  return [
    "# Session handoff",
    "",
    `Saved at: ${new Date().toISOString()}`,
    `Session: ${session.title} (${session.id})`,
    `Provider: ${session.providerId}${model}`,
    `Workspace: ${session.workspacePath}`,
    `Shared project context: ${path.join(projectDirectory(projectId), "context.md")}`,
    "",
    "## Original session instructions",
    "",
    withoutCodexWriteModeBootstrap(session.goal),
    "",
    "## Handoff summary",
    "",
    "_The active AI session has been asked to replace this placeholder with a concise handoff for the next session._",
    "",
    "## Resume checklist",
    "",
    "- Read this handoff and the shared project context.",
    "- Inspect the current repository status and diff before making changes.",
    "- Continue from the remaining work and blockers recorded above."
  ].join("\n");
}
