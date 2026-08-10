import {
  AiInterfaceSessionError,
  updateAiInterfaceSessionReadOnly
} from "../../../interface-session-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SessionRouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: Request, context: SessionRouteContext) {
  const readOnly = await parseReadOnly(request);
  if (readOnly === null) {
    return NextResponse.json({ error: "Read-only mode must be true or false." }, { status: 400 });
  }

  const { sessionId } = await context.params;
  try {
    return NextResponse.json({
      session: await updateAiInterfaceSessionReadOnly(sessionId, readOnly)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update the session read-only mode."
      },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
    );
  }
}

async function parseReadOnly(request: Request): Promise<boolean | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("readOnly" in body) ||
      typeof body.readOnly !== "boolean"
    ) {
      return null;
    }

    return body.readOnly;
  } catch {
    return null;
  }
}
