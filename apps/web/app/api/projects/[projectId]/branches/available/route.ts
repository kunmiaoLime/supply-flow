import { activeParentBranches } from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  listGitBranches,
  RepositoryBranchError
} from "@supply-flow/core/repository-discovery";
import { NextResponse } from "next/server";
import { dataDirectory, projectDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: ProjectRouteContext) {
  const requestUrl = new URL(request.url);
  const repositoryLocal = requestUrl.searchParams.get("repositoryLocal")?.trim();
  const activeOnly = requestUrl.searchParams.get("activeOnly") === "true";
  if (!repositoryLocal || repositoryLocal.length > 4_096) {
    return NextResponse.json(
      { error: "Select a repository associated with this project." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const repository = project.repos.find(
      (currentRepository) => currentRepository.local === repositoryLocal
    );
    if (!repository) {
      return NextResponse.json(
        { error: "Select a repository associated with this project." },
        { status: 400 }
      );
    }

    const localBranches = await listGitBranches(repository.local);
    if (!activeOnly) {
      return NextResponse.json({ branches: localBranches });
    }

    const trackedBranches = await new FileBranchStore(
      projectDirectory(project.project_id)
    ).list();
    return NextResponse.json({
      branches: activeParentBranches(localBranches, trackedBranches, repository.local)
    });
  } catch (error) {
    if (error instanceof RepositoryBranchError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load local branches." },
      { status: 500 }
    );
  }
}
