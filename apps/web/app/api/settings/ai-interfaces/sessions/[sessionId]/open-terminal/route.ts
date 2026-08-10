import {
  AiInterfaceSessionError,
  openAiInterfaceSessionInNativeTerminal
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
    await openAiInterfaceSessionInNativeTerminal(sessionId);
    return NextResponse.json({ opened: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to open the AI session in macOS Terminal."
      },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
    );
  }
}
