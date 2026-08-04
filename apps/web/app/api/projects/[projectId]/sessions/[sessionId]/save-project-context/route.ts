import { readFile } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
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

    const session = await new FileSessionStore(projectDirectory(project.project_id)).get(sessionId);
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

    await tmux.sendInput(
      session.tmuxSessionName,
      await projectContextPrompt(project.project_name, project.project_id)
    );
    return NextResponse.json({ sent: true });
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

async function projectContextPrompt(projectName: string, projectId: string): Promise<string> {
  const template = await readFile(promptPath, "utf8");
  const contextPath = path.join(projectDirectory(projectId), "context.md");
  const prompt = template
    .replaceAll("<PROJECT_NAME>", JSON.stringify(projectName))
    .replaceAll("<PROJECT_CONTEXT_PATH>", JSON.stringify(contextPath));

  // tmux sends an Enter key after this value, so keep the prompt to one logical line.
  return prompt.replace(/\s*\r?\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}
