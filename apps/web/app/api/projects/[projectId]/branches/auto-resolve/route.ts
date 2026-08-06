import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { NextResponse } from "next/server";
import { dataDirectory, projectDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface AutoResolveInput {
  repositoryLocal: string;
  name: string;
  autoResolve: boolean;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch and Auto resolve setting." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;
  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const store = new FileBranchStore(projectDirectory(project.project_id));
    const branch = (await store.list()).find(
      (candidate) =>
        candidate.name === input.name &&
        candidate.repository_local === input.repositoryLocal
    );
    if (!branch) {
      return NextResponse.json(
        { error: "The tracked branch no longer exists. Refresh the project and try again." },
        { status: 404 }
      );
    }

    const updatedBranch = await store.update(branch, {
      ...branch,
      auto_resolve: input.autoResolve
    });
    return NextResponse.json({ branch: updatedBranch });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update Auto resolve."
      },
      { status: 500 }
    );
  }
}

async function parseInput(request: Request): Promise<AutoResolveInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("repositoryLocal" in body) ||
      !("name" in body) ||
      !("autoResolve" in body) ||
      typeof body.repositoryLocal !== "string" ||
      typeof body.name !== "string" ||
      typeof body.autoResolve !== "boolean"
    ) {
      return null;
    }

    const repositoryLocal = body.repositoryLocal.trim();
    const name = body.name.trim();
    if (
      !repositoryLocal ||
      repositoryLocal.length > 4_096 ||
      !name ||
      name.length > 255
    ) {
      return null;
    }

    return { repositoryLocal, name, autoResolve: body.autoResolve };
  } catch {
    return null;
  }
}
