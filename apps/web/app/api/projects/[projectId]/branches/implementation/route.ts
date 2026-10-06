import { startBranchCodingSession, type ProjectBranch } from "@supply-flow/core/branch";
import { resolveAiModelDefault } from "@supply-flow/core/ai-model-settings";
import { FileAiModelSettingsStore } from "@supply-flow/core/file-ai-model-settings-store";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  listGitBranches,
  RepositoryBranchError
} from "@supply-flow/core/repository-discovery";
import { NextResponse } from "next/server";
import {
  branchReviewContext,
  configurationForSession,
  findActiveImplementationSession,
  findSavedImplementationSession,
  pendingReviewSessionConfiguration,
  resumeSavedImplementationSessionGoal
} from "../../../../../branch-review-workflow";
import {
  buildImplementationGoal,
  implementationSessionTitle
} from "../../../../../implementation-session-workflow";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  ProjectSessionError
} from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface BranchImplementationInput {
  repositoryLocal: string;
  name: string;
}

class BranchImplementationError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "BranchImplementationError";
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseBranchImplementationInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch to open its implementation session." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const branch = await findTrackedBranch(project.project_id, input);
    const implementationContext = branchReviewContext(project, branch);
    const activeSession = await findActiveImplementationSession(project.project_id, branch);
    if (activeSession) {
      return NextResponse.json({
        branch,
        session: activeSession,
        reusedSession: true
      });
    }

    if (!branch.parent_branch) {
      throw new BranchImplementationError(
        "The branch has no recorded parent, so its implementation session cannot be restarted safely.",
        409
      );
    }

    const localBranches = await listGitBranches(implementationContext.repository.local);
    if (!localBranches.includes(branch.name)) {
      throw new BranchImplementationError(
        "The tracked branch is not available in the associated local repository.",
        409
      );
    }
    if (!localBranches.includes(branch.parent_branch)) {
      throw new BranchImplementationError(
        "The tracked branch's recorded parent is not available in the associated local repository.",
        409
      );
    }

    const savedSession = await findSavedImplementationSession(project.project_id, branch);
    const reviewerConfiguration =
      pendingReviewSessionConfiguration(branch) ??
      (branch.auto_resolve
        ? resolveAiModelDefault(
            await new FileAiModelSettingsStore(dataDirectory).get(),
            "review-code"
          )
        : undefined);
    const goal = await buildImplementationGoal(
      project,
      implementationContext.task,
      implementationContext.repository,
      implementationContext.issue,
      branch.parent_branch,
      branch.auto_resolve,
      reviewerConfiguration
    );
    const session = await createProjectSession(project, {
      action: "implement-code",
      title: implementationSessionTitle(implementationContext.task, implementationContext.issue),
      goal: savedSession
        ? resumeSavedImplementationSessionGoal(project.project_id, savedSession, goal)
        : goal,
      workspacePath: implementationContext.repository.local,
      additionalWritableDirectories: [projectDirectory(project.project_id)],
      loadProjectContext: true,
      sessionConfiguration: savedSession
        ? await configurationForSession(project.project_id, savedSession.id)
        : undefined
    });
    const updatedBranch = await new FileBranchStore(projectDirectory(project.project_id)).update(
      branch,
      startBranchCodingSession(branch, session.id)
    );

    return NextResponse.json(
      {
        branch: updatedBranch,
        session,
        reusedSession: false
      },
      { status: 201 }
    );
  } catch (error) {
    return branchImplementationErrorResponse(error);
  }
}

async function parseBranchImplementationInput(
  request: Request
): Promise<BranchImplementationInput | null> {
  try {
    return parseBranchImplementationValue(await request.json());
  } catch {
    return null;
  }
}

function parseBranchImplementationValue(value: unknown): BranchImplementationInput | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("repositoryLocal" in value) ||
    !("name" in value) ||
    typeof value.repositoryLocal !== "string" ||
    typeof value.name !== "string"
  ) {
    return null;
  }

  const repositoryLocal = value.repositoryLocal.trim();
  const name = value.name.trim();
  if (
    !repositoryLocal ||
    repositoryLocal.length > 4_096 ||
    !name ||
    name.length > 255
  ) {
    return null;
  }

  return { repositoryLocal, name };
}

async function findTrackedBranch(
  projectId: string,
  input: BranchImplementationInput
): Promise<ProjectBranch> {
  const branch = (await new FileBranchStore(projectDirectory(projectId)).list()).find(
    (candidate) => candidate.name === input.name && candidate.repository_local === input.repositoryLocal
  );
  if (!branch) {
    throw new BranchImplementationError(
      "The tracked branch no longer exists. Refresh the project and try again.",
      404
    );
  }

  return branch;
}

function branchImplementationErrorResponse(error: unknown): NextResponse {
  if (error instanceof BranchImplementationError || error instanceof ProjectSessionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RepositoryBranchError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Unable to open the branch implementation session."
    },
    { status: 500 }
  );
}
