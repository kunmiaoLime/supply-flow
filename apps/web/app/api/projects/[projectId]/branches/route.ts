import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  isTrackableProjectBranchName,
  type ProjectBranch
} from "@supply-flow/core/branch";
import type { ProjectRecord } from "@supply-flow/core/project";
import {
  listGitBranches,
  RepositoryBranchError
} from "@supply-flow/core/repository-discovery";
import { NextResponse } from "next/server";
import { dataDirectory, projectDirectory } from "../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface BranchMutationInput {
  repositoryLocal: string;
  name: string;
  jiraTicket: string | null;
}

interface BranchUpdateInput {
  current: BranchMutationInput;
  branch: BranchMutationInput;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const branches = await new FileBranchStore(projectDirectory(project.project_id)).initialize();
    return NextResponse.json({ branches });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load project branches." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseBranchMutationInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a repository and local branch to import." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    await validateProjectBranch(project, input);
    const branch = await new FileBranchStore(projectDirectory(project.project_id)).add(
      toProjectBranch(input)
    );
    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    return branchErrorResponse(error, "Unable to import the branch.");
  }
}

export async function PATCH(request: Request, context: ProjectRouteContext) {
  const input = await parseBranchUpdateInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a repository and local branch to save." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    await validateProjectBranch(project, input.branch);
    const branchStore = new FileBranchStore(projectDirectory(project.project_id));
    const currentBranch = (await branchStore.list()).find((branch) =>
      isSameBranch(branch, toProjectBranch(input.current))
    );
    if (!currentBranch) {
      return NextResponse.json(
        { error: "The tracked branch no longer exists." },
        { status: 404 }
      );
    }

    const branch = await branchStore.update(currentBranch, {
      ...toProjectBranch(input.branch),
      implementation_session_id: currentBranch.implementation_session_id,
      implementation_session_configuration: currentBranch.implementation_session_configuration,
      review_session_id: currentBranch.review_session_id,
      review_session_configuration: currentBranch.review_session_configuration,
      last_session_id: currentBranch.last_session_id,
      review_result: currentBranch.review_result,
      review_state: currentBranch.review_state,
      auto_resolve: currentBranch.auto_resolve
    });
    return NextResponse.json({ branch });
  } catch (error) {
    return branchErrorResponse(error, "Unable to update the branch.");
  }
}

export async function DELETE(request: Request, context: ProjectRouteContext) {
  const input = parseBranchQuery(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch to remove." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const removed = await new FileBranchStore(projectDirectory(project.project_id)).remove(
      toProjectBranch(input)
    );
    if (!removed) {
      return NextResponse.json({ error: "The tracked branch no longer exists." }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return branchErrorResponse(error, "Unable to remove the branch.");
  }
}

async function validateProjectBranch(
  project: ProjectRecord,
  input: BranchMutationInput
): Promise<void> {
  if (!isTrackableProjectBranchName(input.name)) {
    throw new BranchRouteError("The main and master branches cannot be tracked.", 400);
  }

  const repository = project.repos.find((currentRepository) => currentRepository.local === input.repositoryLocal);
  if (!repository) {
    throw new BranchRouteError("Select a repository currently associated with this project.", 400);
  }
  if (
    input.jiraTicket &&
    !project.tasks.some((task) => task.jira_ticket === input.jiraTicket)
  ) {
    throw new BranchRouteError("Select a Jira ticket currently tracked by this project.", 400);
  }

  const branches = await listGitBranches(repository.local);
  if (!branches.includes(input.name)) {
    throw new BranchRouteError(
      "The selected branch is not available in the selected repository.",
      400
    );
  }
}

async function parseBranchMutationInput(request: Request): Promise<BranchMutationInput | null> {
  try {
    return parseBranchMutationValue(await request.json());
  } catch {
    return null;
  }
}

async function parseBranchUpdateInput(request: Request): Promise<BranchUpdateInput | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("current" in body) || !("branch" in body)) {
      return null;
    }

    const current = parseBranchMutationValue(body.current);
    const branch = parseBranchMutationValue(body.branch);
    return current && branch ? { current, branch } : null;
  } catch {
    return null;
  }
}

function parseBranchQuery(request: Request): BranchMutationInput | null {
  const url = new URL(request.url);
  return parseBranchMutationValue({
    name: url.searchParams.get("name"),
    repositoryLocal: url.searchParams.get("repositoryLocal")
  });
}

function parseBranchMutationValue(value: unknown): BranchMutationInput | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    !("repositoryLocal" in value) ||
    typeof value.name !== "string" ||
    typeof value.repositoryLocal !== "string" ||
    ("jiraTicket" in value && value.jiraTicket !== null && typeof value.jiraTicket !== "string")
  ) {
    return null;
  }

  const name = value.name.trim();
  const repositoryLocal = value.repositoryLocal.trim();
  const jiraTicket =
    "jiraTicket" in value && typeof value.jiraTicket === "string"
      ? value.jiraTicket.trim()
      : null;
  if (
    !name ||
    name.length > 255 ||
    !repositoryLocal ||
    repositoryLocal.length > 4_096 ||
    (jiraTicket !== null && (!jiraTicket || jiraTicket.length > 2_048))
  ) {
    return null;
  }

  return { name, repositoryLocal, jiraTicket };
}

function toProjectBranch(input: BranchMutationInput): ProjectBranch {
  return {
    name: input.name,
    repository_local: input.repositoryLocal,
    merged: false,
    jira_ticket: input.jiraTicket,
    implementation_session_id: null,
    implementation_session_configuration: null,
    review_session_id: null,
    review_session_configuration: null,
    last_session_id: null,
    review_result: null,
    review_state: "coding",
    auto_resolve: false
  };
}

function isSameBranch(first: ProjectBranch, second: ProjectBranch): boolean {
  return first.name === second.name && first.repository_local === second.repository_local;
}

function branchErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof BranchRouteError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RepositoryBranchError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (
    error instanceof Error &&
    error.message === "This branch is already tracked for the selected repository."
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 }
  );
}

class BranchRouteError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "BranchRouteError";
  }
}
