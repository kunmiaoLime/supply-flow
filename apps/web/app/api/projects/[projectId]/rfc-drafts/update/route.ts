import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import {
  ProjectRfcDraftPathSchema,
  type DocumentSource,
  type ProjectRecord,
  type ProjectRepository
} from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  projectRoot,
  ProjectSessionError,
  terminalLogPath
} from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const updateRfcPromptPath = path.join(projectRoot, "prompts", "update_rfc_draft.md");
const tmux = new TmuxAdapter();

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface UpdateRfcDraftInput {
  draftLink: string;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseUpdateRfcDraftInput(request);
  if (!input) {
    return NextResponse.json({ error: "Choose a valid RFC draft." }, { status: 400 });
  }

  const { projectId } = await context.params;
  try {
    const projectStore = new FileProjectStore(dataDirectory);
    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const draft = project.documents.find(
      (document) => document.type === "rfc-draft" && document.link === input.draftLink
    );
    if (!draft) {
      return NextResponse.json({ error: "Unknown RFC draft." }, { status: 404 });
    }

    const projectPath = projectDirectory(project.project_id);
    const draftPath = path.join(projectPath, ...draft.link.split("/"));
    const metadata = await stat(draftPath);
    if (!metadata.isFile()) {
      return NextResponse.json({ error: "The RFC draft file is unavailable." }, { status: 404 });
    }

    const sessionStore = new FileSessionStore(projectPath);
    const activeSession = await findActiveRfcDraftSession(
      project.project_id,
      draft,
      sessionStore
    );
    if (activeSession) {
      if (draft.rfc_session_id !== activeSession.id) {
        await persistRfcDraftSession(projectStore, project, draft, activeSession.id);
      }
      return NextResponse.json({ reusedSession: true, session: activeSession });
    }

    const repositories = selectedRepositories(project, draft);
    const workspaceRepository = repositories[0];
    if (!workspaceRepository) {
      return NextResponse.json(
        { error: "Add a repository before starting an RFC update session." },
        { status: 400 }
      );
    }

    const session = await createProjectSession(project, {
      action: "write-rfc",
      title: `Update RFC: ${draft.title ?? "draft"}`.slice(0, 120),
      goal: buildUpdateRfcGoal(project, draft, repositories),
      workspacePath: workspaceRepository.local,
      additionalWritableDirectories: [
        projectPath,
        ...repositories.map((repository) => repository.local)
      ],
      loadProjectContext: true
    });
    await persistRfcDraftSession(projectStore, project, draft, session.id, repositories);

    return NextResponse.json({ reusedSession: false, session }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to start the RFC update session."
      },
      { status: 500 }
    );
  }
}

async function parseUpdateRfcDraftInput(request: Request): Promise<UpdateRfcDraftInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("draftLink" in body) ||
      typeof body.draftLink !== "string"
    ) {
      return null;
    }

    const draftLink = ProjectRfcDraftPathSchema.safeParse(body.draftLink);
    return draftLink.success ? { draftLink: draftLink.data } : null;
  } catch {
    return null;
  }
}

async function findActiveRfcDraftSession(
  projectId: string,
  draft: DocumentSource,
  store: FileSessionStore
): Promise<SessionRecord | null> {
  const activeTmuxSessions = await activeTmuxSessionNames();

  if (draft.rfc_session_id) {
    const associatedSession = await store.get(draft.rfc_session_id);
    if (associatedSession && isActiveSession(associatedSession, activeTmuxSessions)) {
      return associatedSession;
    }
  }

  for (const session of await store.list()) {
    if (
      !isActiveSession(session, activeTmuxSessions) ||
      !isRfcDraftSession(session) ||
      !(await terminalOutputContains(projectId, session.id, draft.link))
    ) {
      continue;
    }

    return session;
  }

  return null;
}

async function activeTmuxSessionNames(): Promise<Set<string>> {
  try {
    return new Set(await tmux.listSessions());
  } catch {
    return new Set();
  }
}

function isActiveSession(session: SessionRecord, activeTmuxSessions: Set<string>): boolean {
  return (
    (session.status === "starting" || session.status === "running") &&
    activeTmuxSessions.has(session.tmuxSessionName)
  );
}

function isRfcDraftSession(session: SessionRecord): boolean {
  return (
    session.goal.includes("Write an RFC draft") ||
    session.goal.includes("Update an existing RFC draft")
  );
}

async function terminalOutputContains(
  projectId: string,
  sessionId: string,
  draftLink: string
): Promise<boolean> {
  try {
    return (await readFile(terminalLogPath(projectId, sessionId), "utf8")).includes(draftLink);
  } catch {
    return false;
  }
}

function selectedRepositories(
  project: ProjectRecord,
  draft: DocumentSource
): ProjectRepository[] {
  if (!draft.repository_locals) {
    return project.repos;
  }

  const repositoriesByLocal = new Map(
    project.repos.map((repository) => [repository.local, repository] as const)
  );
  const repositories: ProjectRepository[] = [];
  for (const local of draft.repository_locals) {
    const repository = repositoriesByLocal.get(local);
    if (!repository) {
      throw new ProjectSessionError(
        "One or more repositories originally selected for this RFC are no longer associated with the project.",
        409
      );
    }
    repositories.push(repository);
  }

  return repositories;
}

async function persistRfcDraftSession(
  projectStore: FileProjectStore,
  project: ProjectRecord,
  draft: DocumentSource,
  sessionId: string,
  repositories?: readonly ProjectRepository[]
): Promise<void> {
  await projectStore.update(project.project_id, {
    documents: project.documents.map((document) =>
      document.type === "rfc-draft" && document.link === draft.link
        ? {
            ...document,
            rfc_session_id: sessionId,
            ...(repositories
              ? { repository_locals: repositories.map((repository) => repository.local) }
              : {})
          }
        : document
    )
  });
}

function buildUpdateRfcGoal(
  project: ProjectRecord,
  draft: DocumentSource,
  repositories: readonly ProjectRepository[]
): string {
  const projectPath = projectDirectory(project.project_id);
  const draftPath = path.join(projectPath, ...draft.link.split("/"));
  const repositoryScopes = repositories
    .map(
      (repository, index) =>
        `${index + 1}. ${repository.name}\n` +
        `   Local path: ${JSON.stringify(repository.local)}\n` +
        `   Remote: ${repository.remote === null ? "null" : JSON.stringify(repository.remote)}`
    )
    .join("\n");

  return `Update an existing RFC draft for ${JSON.stringify(project.project_name)}.

Read and follow the update workflow at ${updateRfcPromptPath}.
RFC draft: ${JSON.stringify(draftPath)}

Selected repository scopes:
${repositoryScopes}

Only inspect these repository scopes. If this RFC predates repository-scope tracking, confirm the intended backend, frontend, or combined scope with the user before editing.`;
}
