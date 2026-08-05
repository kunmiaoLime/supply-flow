import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { AiProviderIdSchema } from "@supply-flow/core/ai-model-settings";
import { FileAiModelSettingsStore } from "@supply-flow/core/file-ai-model-settings-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");
const AUTHENTICATION_TIMEOUT_MS = 10 * 60 * 1_000;

interface SessionRouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function POST(_request: Request, context: SessionRouteContext) {
  const { projectId, sessionId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const session = await new FileSessionStore(projectDirectory(project.project_id)).get(sessionId);
    if (!session) {
      return NextResponse.json({ error: `Unknown AI session "${sessionId}".` }, { status: 404 });
    }

    const provider = AiProviderIdSchema.safeParse(session.providerId);
    if (!provider.success) {
      return NextResponse.json(
        { error: `Authentication is not configured for ${session.providerId}.` },
        { status: 400 }
      );
    }

    const settings = await new FileAiModelSettingsStore(dataDirectory).get();
    await authenticate(
      settings.authenticationCommands[provider.data],
      session.workspacePath
    );
    return NextResponse.json({ authenticated: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to complete authentication."
      },
      { status: 500 }
    );
  }
}

async function authenticate(
  command: string,
  workspacePath: string
): Promise<void> {
  try {
    // The configurable command is only executed after an explicit local user action.
    await execFile(process.env.SHELL ?? "/bin/sh", ["-lc", command], {
      cwd: workspacePath,
      encoding: "utf8",
      maxBuffer: 64 * 1_024,
      timeout: AUTHENTICATION_TIMEOUT_MS
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(
        "The local shell is unavailable for the configured authentication command."
      );
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "killed" in error &&
      error.killed === true
    ) {
      throw new Error("The configured authentication command timed out before it was completed.");
    }

    throw new Error(
      "The configured authentication command did not complete. Finish any required sign-in, then try again."
    );
  }
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}
