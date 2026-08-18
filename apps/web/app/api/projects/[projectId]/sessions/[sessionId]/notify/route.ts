import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { sendAiSessionPrompt } from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import {
  loadCompletionNotificationCancellationPrompt,
  loadCompletionNotificationPrompt
} from "../../../../../../completion-notification";
import { dataDirectory, projectDirectory } from "../../session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const tmux = new TmuxAdapter();

interface SessionRouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function POST(request: Request, context: SessionRouteContext) {
  const enabled = await parseNotificationEnabled(request);
  if (enabled === null) {
    return NextResponse.json(
      { error: "Completion notification must be enabled or disabled." },
      { status: 400 }
    );
  }

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

    if (session.notifyWhenComplete === enabled) {
      return NextResponse.json({ enabled, session });
    }

    await sendAiSessionPrompt(
      tmux,
      session.tmuxSessionName,
      enabled
        ? await loadCompletionNotificationPrompt(projectRoot)
        : await loadCompletionNotificationCancellationPrompt(projectRoot)
    );
    const updated = await store.update(session.id, { notifyWhenComplete: enabled });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: updated.id,
      timestamp: new Date().toISOString(),
      type: enabled ? "notification-requested" : "notification-canceled",
      message: enabled
        ? "Requested a Slack notification when the current work reaches a terminal state."
        : "Canceled the Slack notification for the current work."
    });
    return NextResponse.json({ enabled, session: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to request a completion notification for the AI session."
      },
      { status: 500 }
    );
  }
}

async function parseNotificationEnabled(request: Request): Promise<boolean | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("enabled" in body) ||
      typeof body.enabled !== "boolean"
    ) {
      return null;
    }

    return body.enabled;
  } catch {
    return null;
  }
}
