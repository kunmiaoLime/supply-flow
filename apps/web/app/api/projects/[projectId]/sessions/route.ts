import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  ProjectSessionError
} from "./session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tmux = new TmuxAdapter();

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface NewSessionInput {
  title: string;
  goal: string;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const store = new FileSessionStore(projectDirectory(project.project_id));
    const tmuxSessionNames = await getTmuxSessionNames();
    const sessions = await Promise.all(
      (await store.list()).map((session) => reconcileSession(store, session, tmuxSessionNames))
    );

    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load AI sessions." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseNewSessionInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Enter a title of 120 characters or fewer and a goal of 16,000 characters or fewer." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const session = await createProjectSession(project, input);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create the AI session." },
      { status: 500 }
    );
  }
}

async function parseNewSessionInput(request: Request): Promise<NewSessionInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("title" in body) ||
      !("goal" in body) ||
      typeof body.title !== "string" ||
      typeof body.goal !== "string"
    ) {
      return null;
    }

    const title = body.title.trim();
    const goal = body.goal.trim();
    if (!title || !goal || title.length > 120 || goal.length > 16_000) {
      return null;
    }

    return { title, goal };
  } catch {
    return null;
  }
}

async function getTmuxSessionNames(): Promise<Set<string>> {
  try {
    return new Set(await tmux.listSessions());
  } catch {
    return new Set();
  }
}

async function reconcileSession(
  store: FileSessionStore,
  session: SessionRecord,
  tmuxSessionNames: Set<string>
): Promise<SessionRecord> {
  if (
    (session.status === "starting" || session.status === "running") &&
    !tmuxSessionNames.has(session.tmuxSessionName)
  ) {
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

  return session;
}
