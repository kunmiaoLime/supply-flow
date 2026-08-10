import {
  AiInterfaceSessionError,
  resizeAiInterfaceTerminal
} from "../../../interface-session-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SessionRouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: Request, context: SessionRouteContext) {
  const dimensions = await parseDimensions(request);
  if (!dimensions) {
    return NextResponse.json({ error: "Terminal size is invalid." }, { status: 400 });
  }

  const { sessionId } = await context.params;
  try {
    await resizeAiInterfaceTerminal(sessionId, dimensions.columns, dimensions.rows);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resize the terminal." },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
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
