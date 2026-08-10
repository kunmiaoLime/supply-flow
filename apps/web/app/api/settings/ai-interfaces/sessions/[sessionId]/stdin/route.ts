import {
  AiInterfaceSessionError,
  sendAiInterfaceTerminalInput
} from "../../../interface-session-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SessionRouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: Request, context: SessionRouteContext) {
  const input = await parseInput(request);
  if (input === null) {
    return NextResponse.json({ error: "Terminal input must be valid base64 data." }, { status: 400 });
  }

  const { sessionId } = await context.params;
  try {
    await sendAiInterfaceTerminalInput(sessionId, input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send terminal input." },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
    );
  }
}

async function parseInput(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("data" in body) ||
      typeof body.data !== "string" ||
      !body.data ||
      body.data.length > 65_536 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)
    ) {
      return null;
    }

    const decoded = Buffer.from(body.data, "base64").toString("utf8");
    return decoded || null;
  } catch {
    return null;
  }
}
