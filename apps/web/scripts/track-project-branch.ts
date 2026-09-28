import {
  AiProviderIdSchema,
  ReasoningEffortSchema,
  supportsReasoningEffort,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { z } from "zod";

interface Arguments {
  projectDirectory: string;
  repositoryLocal: string;
  branch: string;
  parentBranch: string | null;
  jiraTicket: string;
  sessionId: string;
  autoResolve: boolean;
  reviewSessionConfiguration?: ResolvedAiSessionActionSettings;
}

const usage =
  "Usage: track-project-branch --project-directory <path> --repository-local <path> --branch <name> --parent-branch <name> --jira-ticket <url> --session-id <id> --auto-resolve <true|false> [--review-session-configuration <json>]";

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

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const store = new FileBranchStore(arguments_.projectDirectory);
  const trackedBranch = {
    name: arguments_.branch,
    repository_local: arguments_.repositoryLocal,
    parent_branch: arguments_.parentBranch,
    merged: false,
    jira_ticket: arguments_.jiraTicket,
    implementation_session_id: arguments_.sessionId,
    review_session_id: null,
    last_session_id: arguments_.sessionId,
    review_result: null,
    review_state: "coding" as const,
    auto_resolve: arguments_.autoResolve,
    pending_review_session_configuration: arguments_.reviewSessionConfiguration
      ? {
          provider_id: arguments_.reviewSessionConfiguration.providerId,
          model: arguments_.reviewSessionConfiguration.model,
          reasoning_effort: arguments_.reviewSessionConfiguration.reasoningEffort,
          read_only: arguments_.reviewSessionConfiguration.readOnly,
          yolo_mode: arguments_.reviewSessionConfiguration.yoloMode
        }
      : null
  };
  const existing = (await store.list()).find(
    (branch) =>
      branch.name === trackedBranch.name &&
      branch.repository_local === trackedBranch.repository_local
  );
  if (existing?.jira_ticket && existing.jira_ticket !== trackedBranch.jira_ticket) {
    throw new Error(
      `Branch ${trackedBranch.name} is already associated with a different Jira ticket.`
    );
  }

  const nextBranch = existing
    ? {
        ...existing,
        parent_branch: trackedBranch.parent_branch ?? existing.parent_branch,
        jira_ticket: trackedBranch.jira_ticket,
        implementation_session_id: trackedBranch.implementation_session_id,
        review_session_id: null,
        last_session_id: trackedBranch.last_session_id,
        review_result: null,
        review_state: "coding" as const,
        auto_resolve: trackedBranch.auto_resolve,
        pending_review_session_configuration:
          trackedBranch.pending_review_session_configuration
      }
    : trackedBranch;
  const result = existing
    ? {
        branch:
          JSON.stringify(existing) === JSON.stringify(nextBranch)
            ? existing
            : await store.update(existing, nextBranch),
        created: false
      }
    : await store.ensure(nextBranch);

  console.log(
    result.created
      ? `Tracked branch ${result.branch.name}.`
      : `Branch ${result.branch.name} is already tracked for ${result.branch.jira_ticket}.`
  );
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(usage);
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const repositoryLocal = arguments_.get("--repository-local")?.trim();
  const branch = arguments_.get("--branch")?.trim();
  const parentBranchValue = arguments_.get("--parent-branch");
  const parentBranch = parentBranchValue?.trim() || null;
  const jiraTicket = arguments_.get("--jira-ticket")?.trim();
  const sessionId = arguments_.get("--session-id")?.trim();
  const autoResolve = arguments_.get("--auto-resolve")?.trim();
  const reviewSessionConfiguration = parseReviewSessionConfiguration(
    arguments_.get("--review-session-configuration")
  );
  const expectedArgumentCounts = reviewSessionConfiguration ? [7, 8] : [6, 7];
  if (
    !projectDirectory ||
    !repositoryLocal ||
    !branch ||
    !jiraTicket ||
    !sessionId ||
    (autoResolve !== "true" && autoResolve !== "false") ||
    reviewSessionConfiguration === null ||
    (reviewSessionConfiguration && autoResolve !== "true") ||
    !expectedArgumentCounts.includes(arguments_.size)
  ) {
    throw new Error(usage);
  }

  return {
    projectDirectory,
    repositoryLocal,
    branch,
    parentBranch,
    jiraTicket,
    sessionId,
    autoResolve: autoResolve === "true",
    ...(reviewSessionConfiguration ? { reviewSessionConfiguration } : {})
  };
}

function parseReviewSessionConfiguration(
  value: string | undefined
): ResolvedAiSessionActionSettings | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    const configuration = ReviewSessionConfigurationSchema.safeParse(parsed);
    return configuration.success ? configuration.data : null;
  } catch {
    return null;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to track project branch.");
  process.exitCode = 1;
});
