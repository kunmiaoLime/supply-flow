import {
  ProjectBranchReviewStateSchema,
  type ProjectBranchReviewState
} from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { NextResponse } from "next/server";
import { dataDirectory, projectDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface ReviewStateInput {
  repositoryLocal: string;
  name: string;
  reviewState: ProjectBranchReviewState;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch and a valid state." },
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
      review_state: input.reviewState
    });
    return NextResponse.json({ branch: updatedBranch });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update the branch state." },
      { status: 500 }
    );
  }
}

async function parseInput(request: Request): Promise<ReviewStateInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("repositoryLocal" in body) ||
      !("name" in body) ||
      !("reviewState" in body) ||
      typeof body.repositoryLocal !== "string" ||
      typeof body.name !== "string"
    ) {
      return null;
    }

    const repositoryLocal = body.repositoryLocal.trim();
    const name = body.name.trim();
    const parsedReviewState = ProjectBranchReviewStateSchema.safeParse(body.reviewState);
    if (
      !repositoryLocal ||
      repositoryLocal.length > 4_096 ||
      !name ||
      name.length > 255 ||
      !parsedReviewState.success
    ) {
      return null;
    }

    return { repositoryLocal, name, reviewState: parsedReviewState.data };
  } catch {
    return null;
  }
}
