import { NextResponse } from "next/server";
import {
  AiInterfaceSessionError,
  listAiInterfaceSessions
} from "../interface-session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ sessions: await listAiInterfaceSessions() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load setup sessions." },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
    );
  }
}
