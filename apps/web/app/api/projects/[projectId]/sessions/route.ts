import type { ProjectBranch } from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import path from "node:path";
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
    yoloMode: z.boolean(),
    resumeSessionId: z.string().regex(/^[A-Za-z0-9_-]+$/).nullable().optional()
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
    const sessions = await reconcileSessions(store, tmuxSessionNames);
    const branches = await new FileBranchStore(projectDirectory(project.project_id)).list();

    return NextResponse.json({ sessions: orderProjectSessions(sessions, branches) });
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

    const store = new FileSessionStore(projectDirectory(project.project_id));
    const goal = await goalWithSavedHandoff(store, project.project_id, input);
    const session = await createProjectSession(project, {
      action: "new-session",
      goal,
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

async function goalWithSavedHandoff(
  store: FileSessionStore,
  projectId: string,
  input: NewSessionInput
): Promise<string> {
  if (!input.resumeSessionId) {
    return input.goal;
  }

  const source = await store.get(input.resumeSessionId);
  if (!source?.contextFile || (await store.readContext(source.id)) === null) {
    throw new ProjectSessionError(
      "The selected session does not have a saved handoff context.",
      400
    );
  }

  const handoffPath = path.join(projectDirectory(projectId), source.contextFile);
  return [
    `Resume the saved handoff from ${JSON.stringify(handoffPath)} before starting work.`,
    "Treat it as the durable summary from the prior AI session. Inspect the repository status, diff, and relevant files before acting because the previous session may have stopped immediately after saving.",
    "",
    "New session goal:",
    input.goal
  ].join("\n");
}

async function parseNewSessionInput(request: Request): Promise<NewSessionInput | null> {
  try {
    return NewSessionInputSchema.parse(await request.json());
  } catch {
    return null;
  }
}

async function getTmuxSessionNames(): Promise<Set<string>> {
  return new Set(await tmux.listSessions());
}

async function reconcileSession(
  store: FileSessionStore,
  session: SessionRecord,
  tmuxSessionNames: Set<string>
): Promise<SessionRecord | null> {
  if (!tmuxSessionNames.has(session.tmuxSessionName)) {
    if (session.contextFile) {
      return session.status === "stopped"
        ? session
        : store.update(session.id, { lastError: undefined, status: "stopped" });
    }

    await store.remove(session.id);
    return null;
  }

  return session.status === "running"
    ? session
    : store.update(session.id, { lastError: undefined, status: "running" });
}

async function reconcileSessions(
  store: FileSessionStore,
  tmuxSessionNames: Set<string>
): Promise<SessionRecord[]> {
  const sessions: SessionRecord[] = [];

  for (const session of await store.list()) {
    const reconciled = await reconcileSession(store, session, tmuxSessionNames);
    if (reconciled) {
      sessions.push(reconciled);
    }
  }

  return sessions;
}

function orderProjectSessions(
  sessions: SessionRecord[],
  branches: ProjectBranch[]
): SessionRecord[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const reviewSessionIdsByImplementationId = new Map<string, string[]>();

  for (const branch of branches) {
    const implementationSessionId = branch.implementation_session_id;
    const reviewSessionId = branch.review_session_id;
    if (
      !implementationSessionId ||
      !reviewSessionId ||
      implementationSessionId === reviewSessionId ||
      !sessionsById.has(implementationSessionId) ||
      !sessionsById.has(reviewSessionId)
    ) {
      continue;
    }

    const reviewSessionIds =
      reviewSessionIdsByImplementationId.get(implementationSessionId) ?? [];
    if (!reviewSessionIds.includes(reviewSessionId)) {
      reviewSessionIds.push(reviewSessionId);
      reviewSessionIdsByImplementationId.set(implementationSessionId, reviewSessionIds);
    }
  }

  const attachedReviewSessionIds = new Set(
    [...reviewSessionIdsByImplementationId.values()].flat()
  );

  return sessions.flatMap((session) => {
    if (attachedReviewSessionIds.has(session.id)) {
      return [];
    }

    const reviewSessions = (reviewSessionIdsByImplementationId.get(session.id) ?? [])
      .map((reviewSessionId) => sessionsById.get(reviewSessionId))
      .filter((reviewSession): reviewSession is SessionRecord => Boolean(reviewSession));
    return [session, ...reviewSessions];
  });
}
