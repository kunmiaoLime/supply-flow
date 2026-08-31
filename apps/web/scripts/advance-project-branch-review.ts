import { stat } from "node:fs/promises";
import path from "node:path";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { sendAiSessionPrompt } from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import {
  branchReviewContext,
  buildResolveReviewGoal,
  configurationForSession,
  findActiveImplementationSession,
  implementationSessionConfigurationForBranch,
  isReviewResultFilename,
  requestReviewSession
} from "../app/branch-review-workflow";
import {
  createProjectSession,
  projectDirectory
} from "../app/api/projects/[projectId]/sessions/session-service";

const tmux = new TmuxAdapter();

type ReviewEvent = "review-passed" | "review-issues-found" | "code-complete";

interface Arguments {
  projectDirectory: string;
  repositoryLocal: string;
  branch: string;
  event: ReviewEvent;
  reviewResult?: string;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const projectDirectoryPath = path.resolve(arguments_.projectDirectory);
  const projectsDirectory = path.dirname(projectDirectoryPath);
  if (path.basename(projectsDirectory) !== "projects") {
    throw new Error("The project directory must be located directly beneath a projects directory.");
  }

  const projectId = path.basename(projectDirectoryPath);
  const project = await new FileProjectStore(path.dirname(projectsDirectory)).get(projectId);
  if (!project || project.project_id !== projectId) {
    throw new Error("The selected project no longer exists.");
  }
  if (projectDirectory(projectId) !== projectDirectoryPath) {
    throw new Error("The project directory does not match the active Supply Flow data directory.");
  }

  const branchStore = new FileBranchStore(projectDirectoryPath);
  const currentBranch = (await branchStore.list()).find(
    (branch) =>
      branch.name === arguments_.branch &&
      branch.repository_local === arguments_.repositoryLocal
  );
  if (!currentBranch) {
    throw new Error("The tracked branch no longer exists.");
  }

  if (arguments_.event === "review-passed") {
    const branch = await completeReview(branchStore, currentBranch, arguments_, "review_passed");
    console.log(`Review passed for ${branch.name}.`);
    return;
  }

  if (arguments_.event === "review-issues-found") {
    const reviewedBranch = await completeReview(
      branchStore,
      currentBranch,
      arguments_,
      "review_issue_found"
    );
    if (!reviewedBranch.auto_resolve) {
      console.log(`Blocking review issues were recorded for ${reviewedBranch.name}.`);
      return;
    }

    const context = branchReviewContext(project, reviewedBranch);
    const prompt = await buildResolveReviewGoal(context);
    const activeImplementationSession = await findActiveImplementationSession(
      projectId,
      reviewedBranch
    );
    const session = activeImplementationSession
      ? activeImplementationSession
      : await createProjectSession(project, {
          action: "implement-code",
          title: `[${context.issue.key}] Implement resolve review: ${context.task.title}`.slice(
            0,
            120
          ),
          goal: prompt,
          workspacePath: context.repository.local,
          additionalWritableDirectories: [projectDirectory(projectId)],
          loadProjectContext: true,
          sessionConfiguration:
            implementationSessionConfigurationForBranch(reviewedBranch) ??
            (await configurationForSession(
              projectId,
              reviewedBranch.implementation_session_id ?? reviewedBranch.last_session_id
            ))
        });

    if (activeImplementationSession) {
      await sendAiSessionPrompt(tmux, session.tmuxSessionName, prompt);
    }

    await branchStore.update(reviewedBranch, {
      ...reviewedBranch,
      implementation_session_id: session.id,
      last_session_id: session.id,
      review_state: "coding"
    });
    console.log(`Started resolver session ${session.id} for ${reviewedBranch.name}.`);
    return;
  }

  const completedBranch = await branchStore.update(currentBranch, {
    ...currentBranch,
    review_state: "code_complete"
  });
  if (!completedBranch.auto_resolve) {
    console.log(`Code is complete for ${completedBranch.name}; start a review from Supply Flow when ready.`);
    return;
  }

  const context = branchReviewContext(project, completedBranch);
  const review = await requestReviewSession(context);
  console.log(
    `${review.reusedSession ? "Requested" : "Started"} reviewer session ${review.session.id} for ${completedBranch.name}.`
  );
}

async function completeReview(
  store: FileBranchStore,
  branch: Awaited<ReturnType<FileBranchStore["list"]>>[number],
  arguments_: Arguments,
  reviewState: "review_issue_found" | "review_passed"
) {
  if (!arguments_.reviewResult || !isReviewResultFilename(arguments_.reviewResult)) {
    throw new Error("A valid review result Markdown filename is required.");
  }

  const reviewDirectory = path.join(arguments_.projectDirectory, "reviews");
  const reviewPath = path.join(reviewDirectory, arguments_.reviewResult);
  if (path.dirname(reviewPath) !== reviewDirectory) {
    throw new Error("The review result must be located directly beneath the reviews directory.");
  }
  const metadata = await stat(reviewPath);
  if (!metadata.isFile()) {
    throw new Error("The review result file does not exist.");
  }

  return store.update(branch, {
    ...branch,
    review_result: arguments_.reviewResult,
    review_state: reviewState
  });
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: advance-project-branch-review --project-directory <path> --repository-local <path> --branch <name> --event <review-passed|review-issues-found|code-complete> [--review-result <file.md>]"
      );
    }
    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const repositoryLocal = arguments_.get("--repository-local")?.trim();
  const branch = arguments_.get("--branch")?.trim();
  const event = arguments_.get("--event")?.trim();
  const reviewResult = arguments_.get("--review-result")?.trim();
  const requiresReviewResult = event === "review-passed" || event === "review-issues-found";
  if (
    !projectDirectory ||
    !repositoryLocal ||
    !branch ||
    (event !== "review-passed" && event !== "review-issues-found" && event !== "code-complete") ||
    (requiresReviewResult && !reviewResult) ||
    (!requiresReviewResult && reviewResult) ||
    arguments_.size !== (requiresReviewResult ? 5 : 4)
  ) {
    throw new Error(
      "Usage: advance-project-branch-review --project-directory <path> --repository-local <path> --branch <name> --event <review-passed|review-issues-found|code-complete> [--review-result <file.md>]"
    );
  }

  return {
    projectDirectory,
    repositoryLocal,
    branch,
    event,
    ...(reviewResult ? { reviewResult } : {})
  };
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Unable to advance the branch review workflow."
  );
  process.exitCode = 1;
});
