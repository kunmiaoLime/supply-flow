import {
  AiInterfaceSessionError,
  authenticateAiInterfaceSession
} from "../../../interface-session-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SessionRouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(_request: Request, context: SessionRouteContext) {
  const { sessionId } = await context.params;

  try {
    await authenticateAiInterfaceSession(sessionId);
    return NextResponse.json({ authenticated: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to complete authentication."
      },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
    );
  }
}
