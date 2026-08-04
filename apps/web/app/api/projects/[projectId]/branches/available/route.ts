import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  listGitBranches,
  RepositoryBranchError
} from "@supply-flow/core/repository-discovery";
import { NextResponse } from "next/server";
import { dataDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: ProjectRouteContext) {
  const repositoryLocal = new URL(request.url).searchParams.get("repositoryLocal")?.trim();
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

    return NextResponse.json({ branches: await listGitBranches(repository.local) });
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
