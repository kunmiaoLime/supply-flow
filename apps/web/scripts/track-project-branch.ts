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
  implementationSessionConfiguration: ProjectBranchReviewSessionConfiguration | null;
  reviewSessionConfiguration: ProjectBranchReviewSessionConfiguration | null;
}

const usage =
  "Usage: track-project-branch --project-directory <path> --repository-local <path> --branch <name> --jira-ticket <url> --session-id <id> --auto-resolve <true|false> --implementation-provider-id <codex|claude-code> --implementation-model <model|empty> --implementation-reasoning-effort <effort|empty> --implementation-read-only <true|false> --implementation-yolo-mode <true|false> --review-provider-id <codex|claude-code> --review-model <model|empty> --review-reasoning-effort <effort|empty> --review-read-only <true|false> --review-yolo-mode <true|false>";

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const store = new FileBranchStore(arguments_.projectDirectory);
  const trackedBranch = {
    name: arguments_.branch,
    repository_local: arguments_.repositoryLocal,
    merged: false,
    jira_ticket: arguments_.jiraTicket,
    implementation_session_id: arguments_.sessionId,
    implementation_session_configuration: arguments_.implementationSessionConfiguration,
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
        implementation_session_configuration:
          trackedBranch.implementation_session_configuration,
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
      throw new Error(usage);
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const repositoryLocal = arguments_.get("--repository-local")?.trim();
  const branch = arguments_.get("--branch")?.trim();
  const jiraTicket = arguments_.get("--jira-ticket")?.trim();
  const sessionId = arguments_.get("--session-id")?.trim();
  const autoResolve = arguments_.get("--auto-resolve")?.trim();
  if (
    !projectDirectory ||
    !repositoryLocal ||
    !branch ||
    !jiraTicket ||
    !sessionId ||
    (autoResolve !== "true" && autoResolve !== "false") ||
    (arguments_.size !== 6 && arguments_.size !== 11 && arguments_.size !== 16)
  ) {
    throw new Error(usage);
  }

  const implementationSessionConfiguration =
    arguments_.size === 16
      ? parseSessionConfiguration(arguments_, "implementation", "implementation")
      : null;
  const reviewSessionConfiguration =
    arguments_.size === 11 || arguments_.size === 16
      ? parseSessionConfiguration(arguments_, "review", "reviewer")
      : null;

  return {
    projectDirectory,
    repositoryLocal,
    branch,
    jiraTicket,
    sessionId,
    autoResolve: autoResolve === "true",
    implementationSessionConfiguration,
    reviewSessionConfiguration
  };
}

function parseSessionConfiguration(
  arguments_: Map<string, string>,
  prefix: "implementation" | "review",
  label: string
): ProjectBranchReviewSessionConfiguration {
  const providerId = arguments_.get(`--${prefix}-provider-id`)?.trim();
  const model = arguments_.get(`--${prefix}-model`);
  const reasoningEffort = arguments_.get(`--${prefix}-reasoning-effort`);
  const readOnly = arguments_.get(`--${prefix}-read-only`)?.trim();
  const yoloMode = arguments_.get(`--${prefix}-yolo-mode`)?.trim();
  if (
    !providerId ||
    model === undefined ||
    reasoningEffort === undefined ||
    (readOnly !== "true" && readOnly !== "false") ||
    (yoloMode !== "true" && yoloMode !== "false")
  ) {
    throw new Error(usage);
  }

  const configuration = ProjectBranchReviewSessionConfigurationSchema.safeParse({
    provider_id: providerId,
    model: model.trim() || null,
    reasoning_effort: reasoningEffort.trim() || null,
    read_only: readOnly === "true",
    yolo_mode: yoloMode === "true"
  });
  if (!configuration.success) {
    throw new Error(`The ${label} AI session configuration is invalid.`);
  }

  return configuration.data;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to track project branch.");
  process.exitCode = 1;
});
