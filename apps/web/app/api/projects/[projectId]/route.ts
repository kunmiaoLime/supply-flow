import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  ProjectRepositoriesSchema,
  type ProjectRepository
} from "@supply-flow/core/project";
import {
  inspectGitRepository,
  RepositoryInspectionError
} from "@supply-flow/core/repository-discovery";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const local = await parseLocalPath(request);
  if (!local) {
    return NextResponse.json(
      { error: "Enter a local path of 4,096 characters or fewer." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;
  const store = new FileProjectStore(dataDirectory);

  try {
    const currentProject = await store.get(projectId);
    if (!currentProject) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const repository = await inspectGitRepository(local);
    if (currentProject.repos.some((currentRepository) => currentRepository.local === repository.local)) {
      return NextResponse.json(
        { error: "This Git repository is already associated with the project." },
        { status: 409 }
      );
    }

    const project = await store.update(projectId, {
      repos: [...currentProject.repos, repository]
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryInspectionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to inspect the Git repository." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: ProjectRouteContext) {
  const repos = await parseRepositories(request);
  if (!repos) {
    return NextResponse.json(
      { error: "Each repository requires a name and local path." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).update(projectId, { repos });
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update repositories." },
      { status: 404 }
    );
  }
}

async function parseLocalPath(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("local" in body) ||
      typeof body.local !== "string"
    ) {
      return null;
    }

    const local = body.local.trim();
    return local.length > 0 && local.length <= 4_096 ? local : null;
  } catch {
    return null;
  }
}

async function parseRepositories(request: Request): Promise<ProjectRepository[] | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("repos" in body)) {
      return null;
    }

    const parsedRepositories = ProjectRepositoriesSchema.safeParse(body.repos);
    return parsedRepositories.success ? parsedRepositories.data : null;
  } catch {
    return null;
  }
}
