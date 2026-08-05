import { AiModelSettingsSchema } from "@supply-flow/core/ai-model-settings";
import {
  AiModelSettingsError,
  FileAiModelSettingsStore
} from "@supply-flow/core/file-ai-model-settings-store";
import { NextResponse } from "next/server";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory =
  process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");

export async function GET() {
  try {
    const settings = await new FileAiModelSettingsStore(dataDirectory).get();
    return NextResponse.json({ settings });
  } catch (error) {
    return aiModelSettingsErrorResponse(error, "Unable to load AI model settings.");
  }
}

export async function PATCH(request: Request) {
  const settings = await parseSettings(request);
  if (!settings) {
    return NextResponse.json(
      { error: "Enter a valid model and reasoning effort default for every AI session action." },
      { status: 400 }
    );
  }

  try {
    const updatedSettings = await new FileAiModelSettingsStore(dataDirectory).update(settings);
    return NextResponse.json({ settings: updatedSettings });
  } catch (error) {
    return aiModelSettingsErrorResponse(error, "Unable to save AI model settings.");
  }
}

async function parseSettings(request: Request) {
  try {
    return AiModelSettingsSchema.parse(await request.json());
  } catch {
    return null;
  }
}

function aiModelSettingsErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof AiModelSettingsError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 }
  );
}
