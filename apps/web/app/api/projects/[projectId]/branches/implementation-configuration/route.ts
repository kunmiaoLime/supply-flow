import {
  AiProviderIdSchema,
  ReasoningEffortSchema,
  supportsReasoningEffort,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { NextResponse } from "next/server";
import { z } from "zod";
import { findActiveImplementationSession } from "../../../../../branch-review-workflow";
import { dataDirectory, projectDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

const ImplementationConfigurationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    repositoryLocal: z.string().trim().min(1).max(4_096),
    sessionConfiguration: z
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
      })
  });

type ImplementationConfigurationInput = z.infer<
  typeof ImplementationConfigurationInputSchema
>;

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Choose a supported code implementation AI configuration." },
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

    if (await findActiveImplementationSession(project.project_id, branch)) {
      return NextResponse.json(
        { error: "The active code implementation session controls this configuration." },
        { status: 409 }
      );
    }

    const updatedBranch = await store.update(branch, {
      ...branch,
      implementation_session_configuration: toBranchConfiguration(input.sessionConfiguration)
    });
    return NextResponse.json({ branch: updatedBranch });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update the code implementation configuration."
      },
      { status: 500 }
    );
  }
}

async function parseInput(request: Request): Promise<ImplementationConfigurationInput | null> {
  try {
    const parsed = ImplementationConfigurationInputSchema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toBranchConfiguration(
  configuration: ResolvedAiSessionActionSettings
) {
  return {
    provider_id: configuration.providerId,
    model: configuration.model,
    reasoning_effort: configuration.reasoningEffort,
    read_only: configuration.readOnly,
    yolo_mode: configuration.yoloMode
  };
}
