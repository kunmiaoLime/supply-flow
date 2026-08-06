import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectBranch } from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  AiProviderIdSchema,
  ReasoningEffortSchema,
  supportsReasoningEffort,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import {
  listGitBranches,
  RepositoryBranchError
} from "@supply-flow/core/repository-discovery";
import type { SessionRecord } from "@supply-flow/core/session";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  branchReviewContext,
  findActiveImplementationSession,
  findActiveReviewSession,
  isReviewResultFilename,
  requestReviewSession
} from "../../../../../branch-review-workflow";
import {
  dataDirectory,
  projectDirectory,
  ProjectSessionError
} from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface ReviewBranchInput {
  repositoryLocal: string;
  name: string;
  sessionConfiguration?: ResolvedAiSessionActionSettings;
}

class ReviewWorkflowError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ReviewWorkflowError";
  }
}

const ReviewSessionConfigurationSchema = z
  .object({
    providerId: AiProviderIdSchema,
    model: z.string().trim().min(1).max(120).nullable(),
    reasoningEffort: ReasoningEffortSchema.nullable(),
    readOnly: z.boolean(),
    yoloMode: z.boolean()
  })
  .superRefine((configuration, context) => {
    if (!supportsReasoningEffort(configuration.providerId, configuration.reasoningEffort)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The reasoning effort is not supported by the selected AI provider.",
        path: ["reasoningEffort"]
      });
    }
  });

export async function GET(request: Request, context: ProjectRouteContext) {
  const input = parseReviewBranchQuery(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch to view its review." },
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
    const review = await loadReviewResult(project.project_id, branch);
    const session = await findOpenReviewSession(project.project_id, branch);
    const implementationSession = await findActiveImplementationSession(
      project.project_id,
      branch
    );
    return NextResponse.json({
      branch,
      review: review.content === null ? null : { content: review.content, filename: branch.review_result },
      ...(review.error ? { reviewError: review.error } : {}),
      session,
      implementationSession
    });
  } catch (error) {
    return reviewWorkflowErrorResponse(error);
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseReviewBranchInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch to review." },
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
    let reviewContext;
    try {
      reviewContext = branchReviewContext(project, branch);
    } catch (error) {
      throw new ReviewWorkflowError(
        error instanceof Error ? error.message : "Unable to prepare the branch review.",
        409
      );
    }

    const localBranches = await listGitBranches(reviewContext.repository.local);
    if (!localBranches.includes(branch.name)) {
      throw new ReviewWorkflowError(
        "The tracked branch is not available in the associated local repository.",
        409
      );
    }

    const review = await requestReviewSession(reviewContext, input.sessionConfiguration);
    return NextResponse.json(
      {
        branch: review.branch,
        reviewRequested: true,
        reusedSession: review.reusedSession,
        session: review.session
      },
      { status: review.reusedSession ? 200 : 201 }
    );
  } catch (error) {
    return reviewWorkflowErrorResponse(error);
  }
}

async function parseReviewBranchInput(request: Request): Promise<ReviewBranchInput | null> {
  try {
    const body: unknown = await request.json();
    const input = parseReviewBranchValue(body);
    if (!input) {
      return null;
    }

    if (typeof body === "object" && body !== null && "sessionConfiguration" in body) {
      const configuration = ReviewSessionConfigurationSchema.safeParse(
        body.sessionConfiguration
      );
      if (!configuration.success) {
        return null;
      }

      return { ...input, sessionConfiguration: configuration.data };
    }

    return input;
  } catch {
    return null;
  }
}

function parseReviewBranchQuery(request: Request): ReviewBranchInput | null {
  const url = new URL(request.url);
  return parseReviewBranchValue({
    name: url.searchParams.get("name"),
    repositoryLocal: url.searchParams.get("repositoryLocal")
  });
}

function parseReviewBranchValue(value: unknown): ReviewBranchInput | null {
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
  input: ReviewBranchInput
): Promise<ProjectBranch> {
  const branch = (await new FileBranchStore(projectDirectory(projectId)).list()).find(
    (candidate) => candidate.name === input.name && candidate.repository_local === input.repositoryLocal
  );
  if (!branch) {
    throw new ReviewWorkflowError(
      "The tracked branch no longer exists. Refresh the project and try again.",
      404
    );
  }

  return branch;
}

async function loadReviewResult(
  projectId: string,
  branch: ProjectBranch
): Promise<{ content: string | null; error: string | null }> {
  if (!branch.review_result) {
    return { content: null, error: null };
  }
  if (!isReviewResultFilename(branch.review_result)) {
    return {
      content: null,
      error: "The stored review result filename is invalid."
    };
  }

  try {
    return {
      content: await readFile(
        path.join(projectDirectory(projectId), "reviews", branch.review_result),
        "utf8"
      ),
      error: null
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        content: null,
        error: "The stored review result file is no longer available."
      };
    }

    throw error;
  }
}

async function findOpenReviewSession(
  projectId: string,
  branch: ProjectBranch
): Promise<SessionRecord | null> {
  return findActiveReviewSession(projectId, branch);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function reviewWorkflowErrorResponse(error: unknown): NextResponse {
  if (error instanceof ReviewWorkflowError || error instanceof ProjectSessionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RepositoryBranchError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "Unable to start the branch review."
    },
    { status: 500 }
  );
}
