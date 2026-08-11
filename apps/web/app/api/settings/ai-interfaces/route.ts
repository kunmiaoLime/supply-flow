import { z } from "zod";
import { AiInterfaceIdSchema } from "@supply-flow/core/ai-interface";
import {
  AiInterfaceSessionError,
  startOrResumeAiInterfaceSetupSession
} from "./interface-session-service";
import { FileAiInterfaceStore } from "@supply-flow/core/file-ai-interface-store";
import { dataDirectory } from "../../projects/[projectId]/sessions/session-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SetupRequestSchema = z
  .object({
    action: z.enum(["verify", "setup"]),
    interfaces: z.array(AiInterfaceIdSchema).min(1).max(5)
  })
  .refine(
    (input) => new Set(input.interfaces).size === input.interfaces.length,
    "Select each AI interface only once."
  );

export async function GET() {
  try {
    const status = await new FileAiInterfaceStore(dataDirectory).get();
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load AI interface access status."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const input = await parseSetupRequest(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select one or more AI interfaces to verify or set up." },
      { status: 400 }
    );
  }

  try {
    const result = await startOrResumeAiInterfaceSetupSession(input);
    return NextResponse.json(result, { status: result.resumed ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to start the AI interface setup session."
      },
      { status: error instanceof AiInterfaceSessionError ? error.status : 500 }
    );
  }
}

async function parseSetupRequest(
  request: Request
): Promise<{ action: "verify" | "setup"; interfaces: z.infer<typeof AiInterfaceIdSchema>[] } | null> {
  try {
    return SetupRequestSchema.parse(await request.json());
  } catch {
    return null;
  }
}
