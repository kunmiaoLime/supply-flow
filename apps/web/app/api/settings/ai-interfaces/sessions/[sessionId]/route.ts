import { NextResponse } from "next/server";
import {
  AiInterfaceSessionError,
  getAiInterfaceSession,
  readAiInterfaceTerminalOutput,
  terminateAiInterfaceSession
} from "../../interface-session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SessionRouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(request: Request, context: SessionRouteContext) {
  const { sessionId } = await context.params;

  try {
    const session = await getAiInterfaceSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: `Unknown AI interface session "${sessionId}".` }, { status: 404 });
    }

    const output = await readAiInterfaceTerminalOutput(
      session,
      new URL(request.url).searchParams.get("transcript") === "1"
    );
    return NextResponse.json({ ...output, session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the setup session." },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
    );
  }
}

export async function DELETE(_request: Request, context: SessionRouteContext) {
  const { sessionId } = await context.params;

  try {
    const deleted = await terminateAiInterfaceSession(sessionId);
    if (!deleted) {
      return NextResponse.json({ error: `Unknown AI interface session "${sessionId}".` }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to terminate the setup session." },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
    );
  }
}
