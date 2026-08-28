import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { NextResponse } from "next/server";
import { dataDirectory } from "../../sessions/session-service";
import { reconcileActiveBranchMergeStatus } from "../branch-merge-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(_request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    return NextResponse.json(await reconcileActiveBranchMergeStatus(project));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to check branch merge status." },
      { status: 500 }
    );
  }
}
