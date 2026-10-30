import {
  AiProviderIdSchema,
  ReasoningEffortSchema,
  resolveAiModelDefault,
  supportsReasoningEffort,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import { activeParentBranches } from "@supply-flow/core/branch";
import { FileAiModelSettingsStore } from "@supply-flow/core/file-ai-model-settings-store";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  listGitBranches,
  RepositoryBranchError
} from "@supply-flow/core/repository-discovery";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildImplementationGoal,
  implementationSessionTitle,
  parseImplementationJiraIssue
} from "../../../../implementation-session-workflow";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  ProjectSessionError
} from "../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_INSTRUCTIONS_LENGTH = 6_000;

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface ImplementationSessionInput {
  jiraTicket: string;
  repositoryLocal: string;
  parentBranch: string;
  autoResolve: boolean;
  instructions?: string;
  implementationSessionConfiguration?: ResolvedAiSessionActionSettings;
  reviewSessionConfiguration?: ResolvedAiSessionActionSettings;
}

const SessionConfigurationSchema = z
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

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseImplementationSessionInput(request);
  if (!input) {
    return NextResponse.json(
      {
        error:
          "Select a task, repository, and parent branch. Implementation instructions must be 6,000 characters or fewer."
      },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const task = project.tasks.find((currentTask) => currentTask.jira_ticket === input.jiraTicket);
    if (!task) {
      return NextResponse.json(
        { error: "Select a task currently tracked by this project." },
        { status: 400 }
      );
    }

    const repository = project.repos.find(
      (currentRepository) => currentRepository.local === input.repositoryLocal
    );
    if (!repository) {
      return NextResponse.json(
        { error: "Select a repository currently associated with this project." },
        { status: 400 }
      );
    }

    const localBranches = await listGitBranches(repository.local);
    const availableParentBranches = activeParentBranches(
      localBranches,
      await new FileBranchStore(projectDirectory(project.project_id)).list(),
      repository.local
    );
    if (!availableParentBranches.includes(input.parentBranch)) {
      return NextResponse.json(
        { error: "Select an active parent branch. Merged branches cannot be used as a parent." },
        { status: 400 }
      );
    }

    const issue = parseImplementationJiraIssue(task.jira_ticket);
    if (!issue) {
      return NextResponse.json(
        {
          error:
            "The selected task must use a Lime Jira ticket link in the form https://limebike.atlassian.net/browse/KEY-123."
        },
        { status: 400 }
      );
    }

    const aiModelSettings = await new FileAiModelSettingsStore(dataDirectory).get();
    const implementationSessionConfiguration =
      input.implementationSessionConfiguration ??
      resolveAiModelDefault(aiModelSettings, "implement-code");
    const reviewSessionConfiguration = input.autoResolve
      ? (input.reviewSessionConfiguration ??
        resolveAiModelDefault(aiModelSettings, "review-code"))
      : undefined;
    const session = await createProjectSession(project, {
      action: "implement-code",
      title: implementationSessionTitle(task, issue),
      goal: await buildImplementationGoal(
        project,
        task,
        repository,
        issue,
        input.parentBranch,
        input.autoResolve,
        reviewSessionConfiguration,
        input.instructions
      ),
      workspacePath: repository.local,
      additionalWritableDirectories: [projectDirectory(project.project_id)],
      loadProjectContext: true,
      sessionConfiguration: implementationSessionConfiguration
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RepositoryBranchError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to start the implementation session."
      },
      { status: 500 }
    );
  }
}

async function parseImplementationSessionInput(
  request: Request
): Promise<ImplementationSessionInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("jiraTicket" in body) ||
      !("repositoryLocal" in body) ||
      !("parentBranch" in body) ||
      typeof body.jiraTicket !== "string" ||
      typeof body.repositoryLocal !== "string" ||
      typeof body.parentBranch !== "string" ||
      ("autoResolve" in body && typeof body.autoResolve !== "boolean") ||
      ("instructions" in body && typeof body.instructions !== "string")
    ) {
      return null;
    }

    const jiraTicket = body.jiraTicket.trim();
    const repositoryLocal = body.repositoryLocal.trim();
    const parentBranch = body.parentBranch.trim();
    const autoResolve =
      "autoResolve" in body && typeof body.autoResolve === "boolean"
        ? body.autoResolve
        : false;
    const instructions =
      "instructions" in body && typeof body.instructions === "string"
        ? body.instructions.trim()
        : "";
    const implementationSessionConfiguration = parseOptionalSessionConfiguration(
      body,
      "implementationSessionConfiguration"
    );
    const reviewSessionConfiguration = parseOptionalSessionConfiguration(
      body,
      "reviewSessionConfiguration"
    );

    if (
      !jiraTicket ||
      jiraTicket.length > 2_048 ||
      !repositoryLocal ||
      repositoryLocal.length > 4_096 ||
      !parentBranch ||
      parentBranch.length > 255 ||
      instructions.length > MAX_INSTRUCTIONS_LENGTH ||
      implementationSessionConfiguration === null ||
      reviewSessionConfiguration === null
    ) {
      return null;
    }

    return {
      jiraTicket,
      repositoryLocal,
      parentBranch,
      autoResolve,
      ...(implementationSessionConfiguration
        ? { implementationSessionConfiguration }
        : {}),
      ...(reviewSessionConfiguration ? { reviewSessionConfiguration } : {}),
      ...(instructions ? { instructions } : {})
    };
  } catch {
    return null;
  }
}

function parseOptionalSessionConfiguration(
  body: object,
  field: "implementationSessionConfiguration" | "reviewSessionConfiguration"
): ResolvedAiSessionActionSettings | null | undefined {
  if (!(field in body)) {
    return undefined;
  }

  const parsed = SessionConfigurationSchema.safeParse(
    (body as Record<string, unknown>)[field]
  );
  return parsed.success ? parsed.data : null;
}
