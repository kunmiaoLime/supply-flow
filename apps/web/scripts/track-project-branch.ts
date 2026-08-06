import {
  ProjectBranchReviewSessionConfigurationSchema,
  type ProjectBranchReviewSessionConfiguration
} from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";

interface Arguments {
  projectDirectory: string;
  repositoryLocal: string;
  branch: string;
  jiraTicket: string;
  sessionId: string;
  autoResolve: boolean;
  reviewSessionConfiguration: ProjectBranchReviewSessionConfiguration;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const store = new FileBranchStore(arguments_.projectDirectory);
  const trackedBranch = {
    name: arguments_.branch,
    repository_local: arguments_.repositoryLocal,
    jira_ticket: arguments_.jiraTicket,
    implementation_session_id: arguments_.sessionId,
    review_session_id: null,
    review_session_configuration: arguments_.reviewSessionConfiguration,
    last_session_id: arguments_.sessionId,
    review_result: null,
    review_state: "coding" as const,
    auto_resolve: arguments_.autoResolve
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
        jira_ticket: trackedBranch.jira_ticket,
        implementation_session_id: trackedBranch.implementation_session_id,
        review_session_id: null,
        review_session_configuration: trackedBranch.review_session_configuration,
        last_session_id: trackedBranch.last_session_id,
        review_result: null,
        review_state: "coding" as const,
        auto_resolve: trackedBranch.auto_resolve
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
      throw new Error(
        "Usage: track-project-branch --project-directory <path> --repository-local <path> --branch <name> --jira-ticket <url> --session-id <id> --auto-resolve <true|false> --review-provider-id <codex|claude-code> --review-model <model|empty> --review-reasoning-effort <effort|empty> --review-read-only <true|false> --review-yolo-mode <true|false>"
      );
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const repositoryLocal = arguments_.get("--repository-local")?.trim();
  const branch = arguments_.get("--branch")?.trim();
  const jiraTicket = arguments_.get("--jira-ticket")?.trim();
  const sessionId = arguments_.get("--session-id")?.trim();
  const autoResolve = arguments_.get("--auto-resolve")?.trim();
  const reviewProviderId = arguments_.get("--review-provider-id")?.trim();
  const reviewModel = arguments_.get("--review-model");
  const reviewReasoningEffort = arguments_.get("--review-reasoning-effort");
  const reviewReadOnly = arguments_.get("--review-read-only")?.trim();
  const reviewYoloMode = arguments_.get("--review-yolo-mode")?.trim();
  if (
    !projectDirectory ||
    !repositoryLocal ||
    !branch ||
    !jiraTicket ||
    !sessionId ||
    (autoResolve !== "true" && autoResolve !== "false") ||
    !reviewProviderId ||
    reviewModel === undefined ||
    reviewReasoningEffort === undefined ||
    (reviewReadOnly !== "true" && reviewReadOnly !== "false") ||
    (reviewYoloMode !== "true" && reviewYoloMode !== "false") ||
    arguments_.size !== 11
  ) {
    throw new Error(
      "Usage: track-project-branch --project-directory <path> --repository-local <path> --branch <name> --jira-ticket <url> --session-id <id> --auto-resolve <true|false> --review-provider-id <codex|claude-code> --review-model <model|empty> --review-reasoning-effort <effort|empty> --review-read-only <true|false> --review-yolo-mode <true|false>"
    );
  }

  const parsedReviewSessionConfiguration =
    ProjectBranchReviewSessionConfigurationSchema.safeParse({
      provider_id: reviewProviderId,
      model: reviewModel.trim() || null,
      reasoning_effort: reviewReasoningEffort.trim() || null,
      read_only: reviewReadOnly === "true",
      yolo_mode: reviewYoloMode === "true"
    });
  if (!parsedReviewSessionConfiguration.success) {
    throw new Error("The reviewer AI session configuration is invalid.");
  }

  return {
    projectDirectory,
    repositoryLocal,
    branch,
    jiraTicket,
    sessionId,
    autoResolve: autoResolve === "true",
    reviewSessionConfiguration: parsedReviewSessionConfiguration.data
  };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to track project branch.");
  process.exitCode = 1;
});
