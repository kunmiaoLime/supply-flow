import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { findProvider } from "@supply-flow/core/providers";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");
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
  let session: SessionRecord | undefined;
  let store: FileSessionStore | undefined;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const workspacePath = project.repos[0]?.local;
    if (!workspacePath) {
      return NextResponse.json(
        { error: "Add a repository before creating an AI session." },
        { status: 400 }
      );
    }

    const workspace = await stat(workspacePath);
    if (!workspace.isDirectory()) {
      return NextResponse.json(
        { error: "The project's first repository path is not available as a directory." },
        { status: 400 }
      );
    }

    const provider = findProvider("codex");
    if (!provider) {
      throw new Error("Codex provider is not configured.");
    }

    const id = `session_${randomUUID().replaceAll("-", "")}`;
    const tmuxSessionName = `sf_${id}`;
    const timestamp = new Date().toISOString();
    store = new FileSessionStore(projectDirectory(project.project_id));
    session = await store.create({
      schemaVersion: 1,
      id,
      title: input.title,
      goal: input.goal,
      providerId: provider.id,
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

    await tmux.createSession({
      sessionName: tmuxSessionName,
      workspacePath,
      outputPath: terminalLogPath(project.project_id, id),
      launch: provider.createLaunchSpec({ initialPrompt: input.goal })
    });
    session = await store.update(id, { status: "running" });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: id,
      timestamp: new Date().toISOString(),
      type: "started",
      message: `Started ${provider.displayName} in ${tmuxSessionName}.`
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the AI session.";

    if (session && store) {
      try {
        await tmux.terminateSession(session.tmuxSessionName);
      } catch {
        // The process may have failed before tmux finished creating the session.
      }

      await store.update(session.id, { status: "failed", lastError: message });
      await store.appendEvent({
        schemaVersion: 1,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        type: "failed",
        message
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
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

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}

function terminalLogPath(projectId: string, sessionId: string): string {
  return path.join(projectDirectory(projectId), "sessions", sessionId, "terminal.log");
}
