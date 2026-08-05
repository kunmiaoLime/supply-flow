import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import {
  AiProviderIdSchema,
  ReasoningEffortSchema,
  supportsReasoningEffort
} from "@supply-flow/core/ai-model-settings";
import { z } from "zod";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  ProjectSessionError
} from "./session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tmux = new TmuxAdapter();

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

const NewSessionInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    goal: z.string().trim().min(1).max(16_000),
    providerId: AiProviderIdSchema,
    model: z.string().trim().min(1).max(120).nullable(),
    reasoningEffort: ReasoningEffortSchema.nullable(),
    readOnly: z.boolean(),
    yoloMode: z.boolean()
  })
  .superRefine((input, context) => {
    if (!supportsReasoningEffort(input.providerId, input.reasoningEffort)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The reasoning effort is not supported by the selected AI provider.",
        path: ["reasoningEffort"]
      });
    }
  });

type NewSessionInput = z.infer<typeof NewSessionInputSchema>;

export async function GET(_request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const store = new FileSessionStore(projectDirectory(project.project_id));
    const tmuxSessionNames = await getTmuxSessionNames();
    const sessions = await Promise.all(
      (await store.list()).map((session) => reconcileSession(store, session, tmuxSessionNames))
    );

    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load AI sessions." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseNewSessionInput(request);
  if (!input) {
    return NextResponse.json(
      {
        error:
          "Enter a valid title and goal, then choose a supported AI model configuration."
      },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const session = await createProjectSession(project, {
      action: "new-session",
      goal: input.goal,
      sessionConfiguration: {
        providerId: input.providerId,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        readOnly: input.readOnly,
        yoloMode: input.yoloMode
      },
      title: input.title
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create the AI session." },
      { status: 500 }
    );
  }
}

async function parseNewSessionInput(request: Request): Promise<NewSessionInput | null> {
  try {
    return NewSessionInputSchema.parse(await request.json());
  } catch {
    return null;
  }
}

async function getTmuxSessionNames(): Promise<Set<string>> {
  try {
    return new Set(await tmux.listSessions());
  } catch {
    return new Set();
  }
}

async function reconcileSession(
  store: FileSessionStore,
  session: SessionRecord,
  tmuxSessionNames: Set<string>
): Promise<SessionRecord> {
  if (
    (session.status === "starting" || session.status === "running") &&
    !tmuxSessionNames.has(session.tmuxSessionName)
  ) {
    const stopped = await store.update(session.id, { status: "stopped" });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: session.id,
      timestamp: stopped.updatedAt,
      type: "stopped",
      message: `tmux session ${session.tmuxSessionName} is no longer active.`
    });
    return stopped;
  }

  return session;
}
