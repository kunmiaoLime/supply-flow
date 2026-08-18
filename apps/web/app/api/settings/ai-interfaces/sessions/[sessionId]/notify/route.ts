import {
  AiInterfaceSessionError,
  setAiInterfaceSessionCompletionNotification
} from "../../../interface-session-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SessionRouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: Request, context: SessionRouteContext) {
  const enabled = await parseNotificationEnabled(request);
  if (enabled === null) {
    return NextResponse.json(
      { error: "Completion notification must be enabled or disabled." },
      { status: 400 }
    );
  }

  const { sessionId } = await context.params;

  try {
    return NextResponse.json({
      enabled,
      session: await setAiInterfaceSessionCompletionNotification(sessionId, enabled)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to request a completion notification for the AI session."
      },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
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
