import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");
const tmux = new TmuxAdapter();

interface SessionRouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function POST(request: Request, context: SessionRouteContext) {
  const dimensions = await parseDimensions(request);
  if (!dimensions) {
    return NextResponse.json({ error: "Terminal size is invalid." }, { status: 400 });
  }

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

    if (session.status !== "starting" && session.status !== "running") {
      return NextResponse.json({ error: `AI session "${sessionId}" is not running.` }, { status: 409 });
    }

    await tmux.resizeSession(session.tmuxSessionName, dimensions.columns, dimensions.rows);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resize the terminal." },
      { status: 500 }
    );
  }
}

async function parseDimensions(
  request: Request
): Promise<{ columns: number; rows: number } | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("columns" in body) ||
      !("rows" in body) ||
      typeof body.columns !== "number" ||
      typeof body.rows !== "number" ||
      !Number.isInteger(body.columns) ||
      !Number.isInteger(body.rows) ||
      body.columns < 1 ||
      body.columns > 1_000 ||
      body.rows < 1 ||
      body.rows > 1_000
    ) {
      return null;
    }

    return { columns: body.columns, rows: body.rows };
  } catch {
    return null;
  }
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}
